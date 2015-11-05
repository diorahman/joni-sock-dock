var http = require('http');
var Docker = require('dockerode');
var fs = require('fs');
var socketio = require('socket.io');
var socketioStream = require('socket.io-stream');

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

    var ioStream = socketioStream(socket);
    ioStream.on('new', function(stream, options) {

        // FIXME: make it waterfall
        docker.createContainer(containerOptions, function(err, container) {

            container.attach(attachOptions, function(err, attachedContainerStream) {

                attachedContainerStream.pipe(stream).pipe(attachedContainerStream);

                container.start(function(err, data) {
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

