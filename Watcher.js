var DataSource = require('./DataSource');
var inherits = require('inherits');

var REFRESH = 1000;

function Watcher(filePath, refresh) {
    this.setProperties(filePath, refresh);
}

module.exports = Watcher;
inherits(Watcher, DataSource);

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
    DataSource.prototype.setProperties.apply(this, [filePath]);

    this.refresh = refresh || REFRESH;
};
