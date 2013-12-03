var Watcher = require('./Watcher');
var inherits = require('inherits');

// --- Constants ---
var INDEX_PATTERN = /([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);;([^;\r]*)/g;

function IndexWatcher(filePath, refresh) {
    this.setProperties(filePath, refresh);
}

module.exports = IndexWatcher;
inherits(IndexWatcher, Watcher);

IndexWatcher.prototype.setup = function () {
};

IndexWatcher.prototype.publishUpdate = function (data) {
    try {
        this.emit('update', parseIndex(data));
    } catch (err) {
        if (err.name === 'TypeError') {
            this.publishError('IndexParsingError', 'Failed parsing index data');
        } else {
            this.publishError(err);
        }
    }
};

IndexWatcher.prototype.publishError = function (name, message) {
    if (name === 'FileNotFoundError') {
        message = 'Could not find index file at ' + this.filePath;
    }

    Watcher.prototype.publishError.apply(this, [name, message]);
};

function parseIndex(data) {
    INDEX_PATTERN.lastIndex = 0;
    var cards = [];

    for (var indexMatch; indexMatch = INDEX_PATTERN.exec(data);) {
        cards.push({
            range:indexMatch[1],
            relay:indexMatch[2],
            lane:indexMatch[3],
            name:indexMatch[4],
            club:indexMatch[5],
            className:indexMatch[6],
            category:indexMatch[7],
            startsum:indexMatch[8],
            targetID:indexMatch[9]
        });
    }

    return cards;
}
