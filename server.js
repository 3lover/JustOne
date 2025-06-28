// the requirements to connect and create an https websocket server (wss)
const fs = require('fs');
const http = require('http');
const https = require('https');
const privateKey = fs.readFileSync("./security/localhost-key.pem");
const certificate = fs.readFileSync("./security/localhost.pem");
const WebSocket = require("express-ws");
const express = require('express');
const compression = require("compression");
const cors = require("cors");
const app = express();

// allows us to use our modules for packet coding, protocol headers, and utility functions
const protocol = require("./public/json/protocol.json");
const p = require("./serverProtocol");
let sortedWordArray = require("./words").words;

// the player class
class Player {
    constructor(socket, name) {
        this.socket = socket;
        this.name = name;
        this.color = "#ff0000";
        this.clue = "";
        this.spectator = true;
        this.waiting = false;
        this.guessor = false;
        this.host = false;
        this.lobby = null;
        this.clueFilterer = false;
        this.removingOption = false;
    }
}

// the class of our Lobby, which will hold players and the current word/state
class Lobby {
    static lobbies = [];

    constructor(code, hostingPlayer) {
        this.code = code;
        this.host = hostingPlayer;
        this.players = [hostingPlayer];
        this.waitingPlayers = [];
        this.currentCard = "";
        this.cardHistory = [];
        this.points = 0;
        this.cardsRemaining = 0;
        this.cardOptions = [];
        this.gamePhase = 0;
        this.removingPlayers = [];
        this.hints = [];
        this.playerIndex = 0;
        this.correctGuess = true;
        hostingPlayer.socket.talk(p.encodePacket([protocol.client.lobbyJoined, this.code, 1], ["int8", "string", "int8"]));
        this.updateState();
        console.log(`${hostingPlayer.name} created a new lobby with code ${this.code}. There are ${Lobby.lobbies.length + 1} open lobbies now`);
    }

    static findCode(code, joiningPlayer) {
        for (let i = 0; i < Lobby.lobbies.length; i++) {
            if (Lobby.lobbies[i].code !== code) continue;
            Lobby.lobbies[i].addPlayer(joiningPlayer);
            return true;
        }
        return false;
    }

    addPlayer(joiningPlayer) {
        this.waitingPlayers.push(joiningPlayer);
        joiningPlayer.socket.talk(p.encodePacket([protocol.client.lobbyJoined, this.code, 0], ["int8", "string", "int8"]));
        console.log(`${joiningPlayer.name} join the lobby with code ${this.code}`);
        this.updateState();
    }

    kickPlayer(player) {
        this.reset();
        player.socket.talk(p.encodePacket([protocol.client.kicked], ["int8"]))
        this.players.splice(this.players.indexOf(player), 1);
        if (this.players.length === 0) {
            Lobby.lobbies.splice(Lobby.lobbies.indexOf(this));
            return;
        }
        if (player.host) this.players[Math.floor(this.players.length * Math.random())].host = true;
        this.reset();
        this.updateState();
    }

    markCorrect() {
        if (this.correctGuess) return;
        if (this.gamePhase !== 5) return;
        this.points++;
        this.correctGuess = true;
        this.updateState();
    }

    reset() {
        this.gamePhase = 0;
        this.currentCard = "";
        this.cardOptions = [];
        this.hints = [];
        this.finalGuess = "";
        this.players = this.players.concat(this.waitingPlayers);
        this.waitingPlayers = [];
        this.correctGuess = true;
        for (let player of this.players) {
            player.spectator = false;
            player.waiting = false;
            player.guessor = false;
            player.clueFilterer = false;
            player.removingOption = false;
            player.clue = "";
        }
    }

    startGame() {
        this.reset();
        if (this.players.length < 2) {
            this.updateState();
            return;
        }
        this.gamePhase = 1;
        for (let i = 0; i < this.players.length; i++) this.cardOptions.push(sortedWordArray[Math.floor(Math.random() * sortedWordArray.length)]);
        this.removingPlayers = [...this.players];
        this.playerIndex++;
        if (this.playerIndex >= this.players.length) this.playerIndex = 0;
        this.guessor = this.removingPlayers.splice(this.playerIndex, 1)[0];
        this.guessor.guessor = true;
        if (this.playerIndex + 1 >= this.players.length) this.players[this.playerIndex + 1].clueFilterer = true;
        else this.players[0].clueFilterer = true;
        this.removeOption();
    }

    startWriting() {
        if (this.gamePhase !== 1) return;
        this.currentCard = this.cardOptions[0];
        this.gamePhase = 2;
        for (let player of this.players) {
            if (player.guessor) continue;
            player.waiting = true;
        }
        console.log("writing phase")
        this.updateState();
    }

    startRemoval() {
        console.log("removal phase");
        if (this.gamePhase !== 2) return;
        this.gamePhase = 3;
        this.hints = [];
        for (let player of this.players) {
            if (player.guessor) continue;
            let addWord = true;
            for (let h of this.hints) {
                if (h.substring(1) == player.clue.toLowerCase()) {
                    this.hints[this.hints.indexOf(h)] = "!" + h.substring(1);
                    addWord = false;
                }
            }
            if (addWord) this.hints.push("-" + player.clue.toLowerCase());
        }
        this.updateState();
    }

    startGuessing() {
        console.log("guessing phase");
        if (this.gamePhase !== 3) return;
        this.gamePhase = 4;
        for (let i = this.hints.length - 1; i >= 0; i--) {
            if (this.hints[i][0] === "!") this.hints.splice(i, 1);
            else {
                for (let player of this.players) {
                    if (player.clue.toLowerCase() == this.hints[i].toLowerCase.substring(1)) this.hints.splice(i + 1, 0, player.name);
                }
            }
        }
        console.log(this.hints);
        this.updateState();
    }

    removeOption(removedWord) {
        if (this.gamePhase !== 1) return;
        console.log(`remaining options: ${this.cardOptions}`)
        if (this.cardOptions.indexOf(removedWord) !== -1) this.cardOptions.splice(this.cardOptions.indexOf(removedWord), 1);
        else {
            console.log(`Attempted to remove a word (${removedWord}) which could not be found.`);
            console.log("the game has been sent to a waiting state.");
            this.reset();
            this.updateState();
            return;
        }
        if (this.cardOptions.length <= 1) {
            this.startWriting();
            return;
        }
        if (this.removingPlayers.length <= 0) {
            console.log("expended all players, yet words remain, so something went wrong.");
            console.log("the game has been sent to a waiting state.");
            this.reset();
            this.updateState();
            return;
        }

        let remover = this.removingPlayers.splice(Math.floor(this.removingPlayers.length * Math.random()), 1)[0];
        for (let i of this.players) i.removingOption = false;
        remover.removingOption = true;
        let data = [protocol.client.removeCard];
        data.push(this.cardOptions.length);
        for (let word of this.cardOptions) data.push(word);
        data.push(0);
        remover.socket.talk(p.encodePacket(data, ["int8", "repeat", "string", "end"]));
        this.updateState();
    }

    submitGuess(guess) {
        console.log("guess submitted, the game is over");
        this.gamePhase = 5;
        if (guess === this.currentCard) {
            this.points++;
        } else this.correctGuess = false;
        this.cardsRemaining++;
        this.finalGuess = guess;
        this.cardHistory.push(this.currentCard);
        this.updateState();
    }

    submitClue(player, clue, takeback) {
        if (this.gamePhase === 5 && player.host) this.startGame();
        if (this.gamePhase === 4) this.submitGuess(clue.toLowerCase());
        if (this.gamePhase !== 2) return;
        for (let i of this.players) {
            if (player !== i) continue;
            if (takeback) {
                i.waiting = true;
                i.clue = "";
                console.log(`${i.name} unsubmitted their clue`);
            } else {
                i.waiting = false;
                i.clue = clue;
                console.log(`${i.name} submitted the clue ${clue}`);
            }
        }
        let stillWaiting = false;
        for (let i of this.players) {
            if (i.waiting) stillWaiting = true;
        }
        if (!stillWaiting) this.startRemoval();
        else this.updateState();
    }

    toggleClue(clue) {
        if (this.gamePhase !== 3) return;
        for (let hint of this.hints) {
            if (clue !== hint) continue;
            this.hints[this.hints.indexOf(clue)] = hint[0] === "!" ? "-" + hint.substring(1) : "!" + hint.substring(1);
            console.log(`${hint.substring(1)} has been toggled`);
        }
        this.updateState();
    }

    updateState() {
        for (let player of this.players.concat(this.waitingPlayers)) {
            let data = [protocol.client.update];

            data.push(this.players.length + this.waitingPlayers.length);
            for (let i of this.players) {
                data.push(i.name);
                data.push(i.color);
                data.push(i.spectator ? 1 : 0);
                data.push(i.waiting ? 1 : 0);
                data.push(i.guessor ? 1 : 0);
                data.push(i.host ? 1 : 0);
                data.push(i === player ? 1 : 0);
                i.lobby = this;
            }
            for (let i of this.waitingPlayers) {
                data.push(i.name);
                data.push(i.color);
                data.push(i.spectator ? 1 : 0);
                data.push(i.waiting ? 1 : 0);
                data.push(i.guessor ? 1 : 0);
                data.push(i.host ? 1 : 0);
                data.push(i === player ? 1 : 0);
                data.push(i.clueFilterer ? 1 : 0);
                data.push(i.removingOption ? 1 : 0);
                i.lobby = this;
            }
            data.push(0);

            data.push(this.points);
            data.push(this.cardsRemaining);
            data.push(this.currentCard);
            data.push(this.gamePhase);
            data.push(this.finalGuess);

            data.push(this.cardHistory.length);
            for (let card of this.cardHistory) data.push(card);
            data.push(0);

            data.push(this.hints.length);
            for (let clue of this.hints) data.push(clue);
            data.push(0);

            player.socket.talk(p.encodePacket(
                data,
                [
                    "int8", // header
                    "repeat", "string", "string", "int8", "int8", "int8", "int8", "int8", "int8", "int8", "end", // player data
                    "int8", "int8", "string", "int8", "string", // lobby data
                    "repeat", "string", "end", // card history
                    "repeat", "string", "end", // hints
                ]
            ));
        }
    }
}

// defines our websocket which connects to clients to share data
const sockets = {
    tally: 1,
    clients: [],
    class: class {
        // when a new socket is created increase our socket counrt by 1, and assign it that unique id
        constructor(socket, request) {
            this.id = sockets.tally++;

            this.socket = socket;
            this.playerInstance = null;
            this.request = request;
            this.socket.binaryType = "arraybuffer";

            socket.onerror = error => this.error(error);
            socket.onclose = reason => this.close(reason);
            socket.onmessage = data => this.message(data);
        }

        // when we recieve an encoded packet from the client, decode and handle it here
        message(packet) {
            let reader = new DataView(packet.data);

            switch (reader.getInt8(0)) {
                case protocol.server.createLobby: {
                    const d = p.decodePacket(reader, ["int8", "string", "string"]);
                    this.playerInstance = new Player(this, d[2]);
                    if (Lobby.findCode(d[1], this.playerInstance)) break;
                    this.playerInstance.host = true;
                    Lobby.lobbies.push(new Lobby(d[1], this.playerInstance));
                    break;
                }
                // starts the game in the applicable lobby
                case protocol.server.startGame: {
                    if (!this.playerInstance) break;
                    if (!this.playerInstance.host) break;
                    this.playerInstance.lobby.startGame();
                    break;
                }
                // when a player submits their removal choice, we pass it to the next person in line
                case protocol.server.cardRemoved: {
                    if (!this.playerInstance) break;
                    const d = p.decodePacket(reader, ["int8", "string"]);
                    this.playerInstance.lobby.removeOption(d[1]);
                    break;
                }
                // submitting a clue for the word
                case protocol.server.submitClue: {
                    if (!this.playerInstance) break;
                    const d = p.decodePacket(reader, ["int8", "string", "int8"]);
                    this.playerInstance.lobby.submitClue(this.playerInstance, d[1], !!d[2]);
                    break;
                }
                // removing a duplicated word
                case protocol.server.removeClue: {
                    if (!this.playerInstance) break;
                    if (!this.playerInstance.clueFilterer) break;
                    const d = p.decodePacket(reader, ["int8", "string"]);
                    this.playerInstance.lobby.toggleClue(d[1]);
                    break;
                }
                // begin the guessing phase
                case protocol.server.sendClues: {
                    if (!this.playerInstance) break;
                    if (!this.playerInstance.clueFilterer) break;
                    this.playerInstance.lobby.startGuessing();
                    break;
                }
                // begin the guessing phase
                case protocol.server.markCorrect: {
                    if (!this.playerInstance) break;
                    if (!this.playerInstance.host) break;
                    this.playerInstance.lobby.markCorrect();
                    break;
                }
                // kick player
                case protocol.server.kickPlayer: {
                    if (!this.playerInstance) break;
                    if (!this.playerInstance.host) break;
                    const d = p.decodePacket(reader, ["int8", "int8"]);
                    if (!this.playerInstance.lobby.players[d[1]]) break;
                    this.playerInstance.lobby.kickPlayer(this.playerInstance.lobby.players[d[1]]);
                    break;
                }
                // if an unknown packet header is found, log the header for potential troubleshooting
                default: {
                    console.log(`An unknown code has been recieved: ${reader.getInt8(0)}`);
                    break;
                }
            }
        }

        // if the socket is closed or disconnected, find the player and remove it from the lobby
        close() {
            if (this.playerInstance) {
                this.playerInstance.lobby.kickPlayer(this.playerInstance);
            }
            let myIndex = sockets.clients.indexOf(this);
            if (myIndex >= 0) sockets.clients.splice(myIndex, 1);
        }

        // sends an encoded binary packet to the client, where the information will be decoded
        talk(data) {
            if (this.socket.readyState === 1) this.socket.send(data, { binary: true });
        }

        // in the case of an error, throws the error for troubleshooting
        error(error) {
            throw error;
        }

        // kicks a socket, and provides a reason for the kick after closing the port
        kick(reason) {

        }
    },

    // whenever a new connection attempt is identified, we log and verify the connection, and create a socket for the player
    connect(socket, request) {
        console.log(`Socket ${sockets.tally} has connected. Active sockets: ${sockets.clients.length + 1}`);
        let connectingSocket = new sockets.class(socket, request);
        sockets.clients.push(connectingSocket);
        connectingSocket.talk(p.encodePacket([protocol.client.connected], ["int8"]));
    }
}

/*// uses our credentials to create an https server
const credentials = { key: privateKey, cert: certificate };

app.use(express.static("public"));
app.get("/", (req, res) => {
    res.sendFile(__dirname + "public/index.html");
});

const httpServer = http.createServer(app);
const httpsServer = https.createServer(credentials, app);
WebSocket(app, httpsServer);

app.ws("/wss", sockets.connect);

httpServer.listen(8080);
httpsServer.listen(8443, () => {
    console.log("Server running on port 8443")
});*/
const site = ((port, connect) => {
    WebSocket(app);
    
    app.ws("/ws", connect);
    
    app.use(compression());
    //app.use(minify());
    app.use(cors());
    app.use(express.static("public"));
    app.use(express.json());
    
    app.listen(port, () => console.log("Express is now active on port %s", port));
    return (directory, callback) => app.get(directory, callback);
  })(3000, sockets.connect);
  
  app.use(express.static("public"));
  app.get("/", (req, res) => {
      res.sendFile(__dirname + "/public/index.html");
  });