var LiveShot = require('liveshot-dom');
var SourceWatcher = require('./SourceWatcher');

var rangeView = new LiveShot.MegalinkRangeView();
document.body.appendChild(rangeView.el);

var watcher = new SourceWatcher();
watcher.on('update', function (ranges) {
    if (ranges.length > 0) {
        rangeView.setRange(ranges[0], true);
    } else {
        document.body.innerHTML = 'Waiting for data...';
    }
});

watcher.start();

updateSize();
window.onresize = updateSize;

function updateSize() {
    rangeView.el.style.width = window.innerWidth + 'px';
    rangeView.el.style.height = window.innerHeight + 'px';

    rangeView.updateSize();
    rangeView.draw();
}

