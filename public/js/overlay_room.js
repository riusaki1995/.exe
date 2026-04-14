/**
 * Socket.IO desasigna las salas al reconectar. Sin esto, el overlay queda conectado
 * al servidor pero fuera de la sala del streamer y deja de recibir gift/like/etc.
 */
(function () {
    'use strict';
    window.setupOverlaySocketRoom = function (socket, roomName) {
        if (!socket || roomName == null || roomName === '') return;
        var room = String(roomName).trim();
        if (!room) return;
        function join() {
            socket.emit('join_room', room);
        }
        socket.on('connect', join);
        if (socket.connected) join();
    };
})();
