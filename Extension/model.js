/*
 * Copyright 2011-2013 Alex Belozerov, Ilya Stepanov
 *
 * This file is part of PerfectPixel.
 *
 * PerfectPixel is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * PerfectPixel is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with PerfectPixel.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * https://github.com/berzniz/backbone.getters.setters
 */
Backbone.GSModel = Backbone.Model.extend({

    get: function(attr) {
        // Call the getter if available
        if (_.isFunction(this.getters[attr])) {
            return this.getters[attr].call(this);
        }

        return Backbone.Model.prototype.get.call(this, attr);
    },

    set: function(key, value, options) {
        var attrs, attr;

        // Normalize the key-value into an object
        if (_.isObject(key) || key == null) {
            attrs = key;
            options = value;
        } else {
            attrs = {};
            attrs[key] = value;
        }

        // Go over all the set attributes and call the setter if available
        for (attr in attrs) {
            if (_.isFunction(this.setters[attr])) {
                attrs[attr] = this.setters[attr].call(this, attrs[attr]);
            }
        }

        return Backbone.Model.prototype.set.call(this, attrs, options);
    },

    getters: {},

    setters: {}

});

var Overlay = Backbone.GSModel.extend({

    defaults: {
        x: 50,
        y: 50,
        width: 300,
        height: 300,
        opacity: 0.5,
        scale: 1,
        // TODO refactor store in nested model
        filename: '',
        thumbnailFilename: ''
    },

    setters: {
        opacity: function(value) {
            value = Number(value);
            if (value < 0) {
                value = 0;
            } else if (value > 1.0) {
                value = 1.0;
            }
            return value;
        }
    },

    initialize: function() {
        // TODO убрать эти костыли на костыле, или хранить все в Overlay, или сделать нормальный nesting через соотв плагины
        this.image = new OverlayImage();
        this.image.set('filename', this.get('filename'));
        this.image.set('thumbnailFilename', this.get('thumbnailFilename'));

        var self = this;
        this.image.on("change:width", function(model) {
            self.set('width', model.get('width'));
        });
        this.image.on("change:height", function(model) {
            self.set('height', model.get('height'));
        });
        this.image.on("change:filename", function(model) {
            self.set('filename', model.get('filename'));
        });
        this.on("change:filename", function(model) {
            self.image.set('filename', model.get('filename'));
        });
        this.image.on("change:thumbnailFilename", function(model) {
            self.set('thumbnailFilename', model.get('thumbnailFilename'));
        });
        this.on("change:thumbnailFilename", function(model) {
            self.image.set('thumbnailFilename', model.get('thumbnailFilename'));
        });
    },

    uploadFile: function(file, callback) {
        this.image.uploadFile(file, callback);
    }
});

var OverlayCollection = Backbone.Collection.extend({
    model: Overlay,
    localStorage: new Backbone.LocalStorage('perfectpixel-overlays')
});

var OverlayImage = Backbone.GSModel.extend({

    // TODO for both /2, for now Canvas in Chrome scales images very bad without antialiasing, so using workaround CSS scaling
    thumbnailMinWidth: 188,
    thumbnailMinHeight: 120,

    defaults: {
        filename: '',
        thumbnailFilename: ''
    },

    initialize: function() {
    },

    getImageUrlAsync: function(callback) {
        if(this.imageUrl)
            callback(this.imageUrl);
        else
        {
            this._getImageUrlByFilename(this.get('filename'), $.proxy(function(imageUrl, response) {
                this.imageUrl = imageUrl;
                callback(this.imageUrl);
            }, this));
        }
    },

    getThumbnailUrlAsync: function(callback) {
        if(this.thumbnailImageUrl)
            callback(this.thumbnailImageUrl);
        else
        {
            this._getImageUrlByFilename(this.get('thumbnailFilename'), $.proxy(function(thumbImageUrl, response) {
                this.thumbnailImageUrl = thumbImageUrl;
                callback(this.thumbnailImageUrl);
            }, this));
        }
    },

    // Overriding getting model
    /*sync: function(method, model, options) {
        model._getImageUrlByFilename(this.filename, function(imageUrl, response) {
            this.imageUrl = imageUrl;
            var success = options.success;
            if (success) success(model, response, options);
            model.trigger('sync', model, response, options);
        })
    },*/

    uploadFile: function(file, callback) {
        // Only process image files.
        if (!file.type.match('image.*')) {
            alert('File must contain image');
            callback();
            return;
        }

        var self = this;
        var reader = new FileReader();
        reader.onload = function (e) {

            // 1. Add full size image to storage
            console.log("PP Add file operation");
            chrome.extension.sendRequest(
                {
                    type: PP_RequestType.ADDFILE,
                    fileData: bufferToString(e.target.result),
                    fileName: file.name,
                    fileType: file.type
                },
                function (response) {
                    self._handleResponse(response);

                    if (response.status == "OK") {

                        var dataView = new DataView(stringToBuffer(response.arrayBuffer));
                        var blob = new Blob([dataView],{type:response.fileType});

                        self.imageUrl = PPImageTools.createBlobUrl(blob);
                        self.set('filename', response.fileName);

                        // 2. Generate thumbnail image
                        PPImageTools.ResizeBlob(blob, self.thumbnailMinWidth, self.thumbnailMinHeight,
                            function(resizedBlob, img) {
                                self.set('width', img.width);
                                self.set('height', img.height);

                                PPImageTools.getArrayBufferFromBlob(resizedBlob, function(resizedBlobBuffer) {

                                    // 3. Add thumbnail image to storage
                                    console.log("PP Add file operation - thumbnail");
                                    chrome.extension.sendRequest(
                                        {
                                            type: PP_RequestType.ADDFILE,
                                            fileData: bufferToString(resizedBlobBuffer),
                                            fileName: file.name,
                                            fileType: resizedBlob.type
                                        },
                                        function (responseThumb) {
                                            self._handleResponse(responseThumb);

                                            if (responseThumb.status == "OK") {
                                                var dataViewThumb = new DataView(stringToBuffer(responseThumb.arrayBuffer));
                                                var blobThumb = new Blob([dataViewThumb],{type:responseThumb.fileType});

                                                self.thumbnailUrl = PPImageTools.createBlobUrl(blobThumb);
                                                self.set('thumbnailFilename', responseThumb.fileName);

                                                callback();
                                            }
                                        });
                                });
                            }
                        );
                    }
                    else
                        callback();
                });
        }
        reader.onerror = function (stuff) {
            console.log("PP error", stuff);

            if (stuff.getMessage) {
                console.log(stuff.getMessage());
            }
            else {
                // it might be the local file secutiry error.
                // See http://stackoverflow.com/questions/6665457/updateusing-filereader-in-chrome
                if (stuff.type == 'error' && document.location.protocol == 'file:')
                    alert('It looks like you are trying to use the extension on a local html page. Unfortunately, due to security reasons, Chrome doesn\'t allow scripts to access the local files from the local pages unless you start the browser with --allow-file-access-from-files flag.');
            }

            callback();
        }
        reader.readAsArrayBuffer(file);
    },

    /**
     *
     * @param filename
     * @param [callback]
     * @private
     */
    _getImageUrlByFilename: function(filename, callback) {
        if (filename) {
            console.time("PP Profiling _getImageUrlByFilename " + filename);
            var self = this;
            chrome.extension.sendRequest({
                    type: PP_RequestType.GETFILE,
                    fileName: filename
                },
                function (response) {
                    self._handleResponse(response);
                    if (response.status == "OK") {
                        var dataView = new DataView(stringToBuffer(response.arrayBuffer));
                        var blob = new Blob([dataView],{type:response.fileType});
                        var imageUrl = PPImageTools.createBlobUrl(blob);
                    }
                    console.timeEnd("PP Profiling _getImageUrlByFilename " + filename);

                    callback && callback(imageUrl, response);
                });
        } else {
            console.error("Attempt to get image url for empty filename");
            callback && callback(null);
        }
    },

    /**
     * Handle response came from background page file manager
     * @param response
     * @private
     */
    _handleResponse: function(response) {
        console.log("PP " + response.status);
        if (response.message && response.showToUser) {
            alert(response.message);
        }
    }
});

var PerfectPixelModel = Backbone.Model.extend({
    defaults: {
        currentOverlayId: null,
        overlayShown: true,
        overlayLocked: false
    },

    localStorage: new Backbone.LocalStorage('perfectpixel'),

    initialize: function() {
        this.overlays = new OverlayCollection();
        this.overlays.bind('remove', this.overlayRemoved, this);
    },

    getCurrentOverlay: function() {
        if (this.has('currentOverlayId')) {
            return this.overlays.get(this.get('currentOverlayId'));
        } else {
            return null;
        }
    },

    setCurrentOverlay: function(overlay) {
        this.save({currentOverlayId: overlay.id});
    },

    isOverlayCurrent: function(overlay) {
        return this.get('currentOverlayId') === overlay.id
    },

    toggleOverlayShown: function() {
        this.save({overlayShown: !this.get('overlayShown')});
    },

    toggleOverlayLocked: function() {
        this.save({overlayLocked: !this.get('overlayLocked')});
    },

    overlayRemoved: function(overlay) {
        if (overlay.id === this.get('currentOverlayId')) {
            var firstOverlay = this.overlays.first();
            if (firstOverlay) {
                this.save({currentOverlayId: firstOverlay.id});
            } else {
                this.save({currentOverlayId: null});
            }
        }
    }
 });
var PerfectPixel = new PerfectPixelModel({ id: 1 });
