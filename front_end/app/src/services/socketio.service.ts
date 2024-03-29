import { HOST } from "@/constants/constants";
import { io, Socket } from "socket.io-client";

class SocketioService {
    socket?: Socket;
    constructor() {
    }
    setupSocketConnection() {
        this.socket = io(`http://${HOST}:3001`, {
            transports: ["websocket"],
            withCredentials: true,
        });
        return this.socket;
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }

    release(event: string, message: string) {
        if (this.socket) {
            this.socket.emit(event, message);
        }
    }
}

export default new SocketioService();
