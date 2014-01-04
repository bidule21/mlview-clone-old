var Watcher = require('./Watcher');
var inherits = require('inherits');

// --- Constants ---
var VERSION_PATTERN = /([^;\r\n]*);(\d*)/g;
var SERIES_PATTERN = /([^_\r\n]*)_([^\.]*).txt/;
var INDEX_FILE = 'index.txt';

function VersionWatcher(filePath, refresh) {
    this.setProperties(filePath, refresh);
    this.setup();
}

module.exports = VersionWatcher;
inherits(VersionWatcher, Watcher);

// --- Internal API ---
VersionWatcher.prototype.setup = function () {
    this.versions = {};
};

VersionWatcher.prototype.publishData = function (data) {
    try {
        this.updateVersion(parseVersion(data));
    } catch (err) {
        err.response = data;

        if (err.name === 'TypeError') {
            this.publishError('VersionParsingError', 'Failed parsing version data', err);
        } else {
            this.publishError(err);
        }
    }
};

VersionWatcher.prototype.publishError = function (name, message, error) {
    if (name === 'FileNotFoundError') {
        message = 'Could not find version file at ' + this.filePath;
    }

    Watcher.prototype.publishError.apply(this, [name, message, error]);
};

VersionWatcher.prototype.updateVersion = function (versions) {
    var cards = [];

    for (var file in versions) {
        var version = versions[file];
        var oldVersion = this.versions[file];

        if (version != oldVersion) {
            this.versions[file] = version;

            this.emit('update', file);
        }

        var match = SERIES_PATTERN.exec(file);
        if (match) {
            cards.push({lane:match[2], range:match[1]});
        }
    }

    this.emit('cards', cards);
};

function parseVersion(data) {
    var versions = {};
    VERSION_PATTERN.lastIndex = 0;

    for (var match; match = VERSION_PATTERN.exec(data);) {
        versions[match[1]] = match[2];
    }

    return versions;
}
