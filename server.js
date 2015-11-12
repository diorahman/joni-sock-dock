var http = require('http');
var Docker = require('dockerode');
var fs = require('fs');
var socketio = require('socket.io');
var socketioStream = require('socket.io-stream');
var passStream = require('pass-stream');

var port = process.env.PORT || 3000;
var ip = process.env.IP || '0.0.0.0';

var server = http.createServer();
var docker = new Docker();

var containerOptions = {
    'AttachStdin': true,
    'AttachStdout': true,
    'AttachStderr': true,
    'Tty': true,
    'OpenStdin': true,
    'StdinOnce': false,
    'Env': null,
    'Cmd': ['bash'],
    'Image': 'cpp'
};

var attachOptions = {
    stream: true,
    stdin: true,
    stdout: true,
    stderr: true
};

server.on('request', function(req, res) {

    var file = null;
    switch(req.url) {

        case '/':
        case '/index.html':
            file = '/index.html';
            break;
        case '/socket.io-stream.js':
            file = '/node_modules/socket.io-stream/socket.io-stream.js';
            break;
        case '/terminal.js':
            file = '/node_modules/terminal.js/dist/terminal.js';
            break;
        default:
            res.writeHead(404, {'Content-Type': 'text/plain'});
            res.end('Not found');
            return;
    }

    fs.createReadStream(__dirname + file).pipe(res);
});

var io = socketio(server).of('joni');


io.on('connection', function(socket) {

    var count = 0;
    socket.terminal = {};
    socket.terminal.buffer = '';

    socket.on('error', function() {
        if (!socket.container) {
            return;
        }
        var container = socket.container;
        container.stop(function(err) {

            container.remove(function(err) {
                console.log(err || container.id + ' removed.');
            });
        });
    });

    socket.on('disconnect', function() {
        if (!socket.container) {
            return;
        }
        var container = socket.container;
        container.stop(function(err) {

            container.remove(function(err) {
                console.log(err || container.id + ' removed.');
            });
        });
    });

    var psWriteFn = function(data, encoding, cb) {

        var buffer = data.toString();
        if (socket.state == 'NEW') {
            socket.prompt = buffer;

        } else if (socket.state == 'WRITE') {
            if (buffer.indexOf(socket.prompt) >= 0) {
                socket.terminal.buffer = '';
                socket.containerStream.write('make');
                socket.containerStream.write(String.fromCharCode(13));
                socket.state = 'COMPILE';
            }
        } else if (socket.state == 'COMPILE') {
            socket.terminal.buffer += buffer;

            var line = buffer.split(socket.prompt).join('');
            if (line.trim() != 'make') {
                this.push(line);
            }

            if (buffer.indexOf(socket.prompt) >= 0) {

                // FIXME: check for error
                if (socket.terminal.buffer.indexOf('make: ***') < 0) {
                    socket.terminal.buffer = '';
                    socket.containerStream.write('./app');
                    socket.containerStream.write(String.fromCharCode(13));
                    socket.state = 'RUN';
                } else {
                    this.push('Compilation error.\r\n');
                }
            }
        } else if (socket.state == 'RUN') {
            socket.terminal.buffer += buffer;
            var line = buffer.split(socket.prompt).join('');
            this.push(line);
            if (buffer.indexOf(socket.prompt) >= 0) {
                socket.terminal.buffer = '';
                console.log('run done');
                this.push('Process finished.\r\n');
            }
        } else {
            var line = buffer.split(socket.prompt).join('');
            this.push(line);
        }
        cb();
    }

    var psEndFn = function(cb) {
        cb();
    }

    var ps = passStream(psWriteFn, psEndFn);

    var ioStream = socketioStream(socket);

    ioStream.on('compile', function(stream, data) {
        socket.state = 'WRITE';
        var sources = data.sources;

        var writeCommand = '';

        for (var file in sources) {
            writeCommand += 'printf \'' + sources[file] + '\' > ' + file + ' ;';
        }
        socket.containerStream.write(writeCommand);
        socket.containerStream.write(String.fromCharCode(13));
    });

    ioStream.on('run', function(stream, data) {
        socket.containerStream.write(data);
    });

    ioStream.on('clear', function(stream, data) {
        socket.state = 'CLEAR';
        socket.containerStream.write('clear');
        socket.containerStream.write(String.fromCharCode(13));
    });

    ioStream.on('new', function(stream, options) {

        // FIXME: make it waterfall
        docker.createContainer(containerOptions, function(err, container) {

            socket.container = container;

            container.attach(attachOptions, function(err, attachedContainerStream) {

                socket.containerStream = attachedContainerStream;
                socket.state = 'NEW';

                var filtered = socket.containerStream.pipe(ps);

                filtered.on('data', function(chunk) {
                    if (socket.state == 'COMPILE' || socket.state == 'RUN' || socket.state == 'CLEAR') {
                        stream.write(chunk);
                    }
                });

                container.start(function(err, data) {
                    // FIXME: notify front-end, we're ready or doomed
                    console.log(err || data || (container.id + ' started.'));
                });

            });
        });
    });
});

server.listen(port, ip);

