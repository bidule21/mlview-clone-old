var Watcher = require('./Watcher');
var inherits = require('inherits');

// --- Constants ---
var INDEX_PATTERN = /([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);;([^;\r]*)/g;

function IndexWatcher(filePath, refresh) {
    this.setProperties(filePath, refresh);
}

module.exports = IndexWatcher;
inherits(IndexWatcher, Watcher);

IndexWatcher.prototype.publishUpdate = function (data) {
    this.emit('update', parseIndex(data));
};

function parseIndex(data) {
    INDEX_PATTERN.lastIndex = 0;
    var cards = [];

    try {
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

        console.dir(cards);
    } catch (err) {
        if (err.name === 'TypeError') {
            throw {
                name:'IndexParsingError',
                essage:'Could not parse index'
            };
        } else {
            throw err;
        }
    }

    return cards;
}
