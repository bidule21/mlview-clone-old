var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');

function DataSource(filePath) {
    this.setProperties(filePath);
}

module.exports = DataSource;
inherits(DataSource, EventEmitter);

// --- External API ---
DataSource.prototype.stageUpdate = function () {
    if (this.updating) return;

    this.update();
};

// --- Internal API ---
DataSource.prototype.setProperties = function (filePath) {
    this.filePath = filePath;
};

DataSource.prototype.update = function () {
    this.updating = true;

    var self = this;
    loadFile(this.filePath, this.etag, function (err, data, etag) {
        if (!err) {
            self.etag = etag;
            self.publishData(data);
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

DataSource.prototype.publishData = function (data) {
    this.emit('data', data);
};

DataSource.prototype.publishError = function (name, message) {
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
            } else if (request.status == 200 || (request.status == 0 && request.response)) {
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
