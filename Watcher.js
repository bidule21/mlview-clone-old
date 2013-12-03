var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');

var REFRESH = 1000;

function Watcher(filePath, refresh) {
    this.setProperties(filePath, refresh);
}

module.exports = Watcher;
inherits(Watcher, EventEmitter);

// --- External API ---
Watcher.prototype.start = function () {
    var self = this;
    this.interval = setInterval(function () {
        self.stageUpdate();
    }, this.refresh);

    this.stageUpdate();
};

Watcher.prototype.stop = function () {
    clearInterval(this.interval);
};

// --- Internal API ---
Watcher.prototype.setProperties = function (filePath, refresh) {
    this.filePath = filePath;
    this.refresh = refresh || REFRESH;
};

Watcher.prototype.stageUpdate = function () {
    if (this.updating) return;

    this.update();
};

Watcher.prototype.update = function () {
    this.updating = true;

    var self = this;
    loadFile(this.filePath, this.etag, function (err, data, etag) {
        if (!err) {
            self.etag = etag;
            self.publishUpdate(data);
        } else {
            switch (err) {
                case 'FileNotModifiedError':
                    break;
                case 'FileNotFoundError':
                    self.publishError(err, 'Could not find ' + self.filePath);
                default:
                    self.publishError(err);
            }
        }

        self.updating = false;
    });
};

Watcher.prototype.publishUpdate = function (data) {
    this.emit('update', data);
};

Watcher.prototype.publishError = function (name, message) {
    var err = new Error(message || 'Unknown error');
    err.name = name;

    this.emit('error', err);

    return err;
};

function loadFile(filePath, etag, callback) {
    if (!callback) {
        callback = etag;
        etag = undefined;
    }

    var request = new XMLHttpRequest();

    request.onreadystatechange = function() {
        if (request.readyState == 4) {
            if (request.status == 304) {
                callback('FileNotModifiedError');
            } else if (request.status == 200) {
                callback(null, request.responseText, request.getResponseHeader('etag'));
            } else {
                callback('FileNotFoundError');
            }
        }
    }

    request.open('GET', filePath + '?' + new Date().valueOf(), true);
    if (etag) {
        request.setRequestHeader('If-None-Match', etag);
    }
    request.send();
}
