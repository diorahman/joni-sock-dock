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

    var psWriteFn = function(data, encoding, cb) {

        if (socket.state == 'NEW') {
            socket.prompt = data.toString().trim();
        } else if (data.toString().trim().indexOf(socket.prompt) >= 0 && socket.state == 'WRITE') {
            if (!socket.terminal.start) {
                socket.terminal.start = true;
            }

            if (socket.terminal.start) {
                console.log('write done');
                socket.terminal.buffer = '';
                socket.terminal.start = false;

                // write done, then compile
                socket.containerStream.write('clear && g++ main.cpp');
                socket.containerStream.write(String.fromCharCode(13));
                socket.state = 'COMPILE';
                socket.terminal.hasError = false;
            }
        } else {
            // Buffer is data without prompt
            var buffer = data.toString().split(socket.prompt).join('');

            if (socket.state == 'COMPILE') {
                var r = buffer.charCodeAt(buffer.length - 1);
                var n = buffer.charCodeAt(buffer.length - 2);
                if (buffer.length == 1 && r == 32) {
                    if (!socket.terminal.hasError) {
                        this.push(socket.terminal.buffer);
                        this.push('Compiled successfully!\r\n');

                        // then run!
                        socket.state = 'RUN';
                        socket.containerStream.write('./a.out');
                        socket.containerStream.write(String.fromCharCode(13));
                    }
                }
                if (r == 10 && n == 13) {
                    socket.terminal.buffer += buffer;
                    console.log(socket.terminal.buffer);
                    if (socket.terminal.buffer.indexOf('g++') < 0) {
                        // FIXME: detect error
                        console.log('has error');
                        socket.terminal.hasError = true;
                        this.push(socket.terminal.buffer);
                    }
                    socket.terminal.buffer = '';
                } else {
                    socket.terminal.buffer += buffer;
                }
            } else if (socket.state == 'RUN') {
                this.push(buffer);
            }
        }
        cb();
    }

    var psEndFn = function(cb) {
        cb();
    }

    var ps = passStream(psWriteFn, psEndFn);

    var ioStream = socketioStream(socket);

    ioStream.on('compile', function(stream, data) {
        count = 0;
        socket.state = 'WRITE';

        // FIXME: Create a project from source codes
        //
        // { sources: {'main.cpp': '#include ...'}, options: {'flags': '-O ..'} }
        //
        //
        var sources = data.sources;
        socket.containerStream.write('printf \'' + sources['main.cpp'] + '\' > main.cpp');
        socket.containerStream.write(String.fromCharCode(13));
    });

    ioStream.on('run', function(stream, data) {
        socket.containerStream.write(data);
    });

    ioStream.on('new', function(stream, options) {

        // FIXME: make it waterfall
        docker.createContainer(containerOptions, function(err, container) {

            container.attach(attachOptions, function(err, attachedContainerStream) {

                socket.containerStream = attachedContainerStream;
                socket.state = 'NEW';

                var filtered = socket.containerStream.pipe(ps);

                filtered.on('data', function(chunk) {
                    if (socket.state == 'COMPILE' || socket.state == 'RUN') {
                        stream.write(chunk);
                    }
                });

                container.start(function(err, data) {
                    // FIXME: notify front-end, we're ready or doomed
                    console.log(err || data || (container.id + ' started.'));
                });

                socket.on('disconnect', function() {
                    container.stop(function(err) {

                        container.remove(function(err) {
                            console.log(err || container.id + ' removed.');
                        });
                    });
                });
            });
        });
    });
});

server.listen(port, ip);

