var LiveShot = require('liveshot-dom');
var MegalinkWatcher = require('./MegalinkWatcher');

// setup scale
if (window.devicePixelRatio) {
    var meta = document.head.getElementsByTagName('meta')[0];
    meta.content = 'width=device-width, user-scalable=no, initial-scale=' + (1/window.devicePixelRatio);
}

// setup views
var rangeView = new LiveShot.MegalinkRangeView();
document.body.appendChild(rangeView.el);

var watcher = new MegalinkWatcher();
watcher.on('update', function (ranges) {
    if (ranges.length > 0) {
        rangeView.setRange(ranges[0], true);
        hideSpinner();
    } else {
        document.body.innerHTML = 'Waiting for data...';
    }
});

watcher.on('error', function (err) {
    console.error(err);
});

setSpinnerLabel('Laster skiver');
watcher.start();

updateSize();
window.onresize = updateSize;

function updateSize() {
    var width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
    var height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;

    rangeView.el.style.width = width + 'px';
    rangeView.el.style.height = height + 'px';

    rangeView.updateSize();
    rangeView.draw();
}
