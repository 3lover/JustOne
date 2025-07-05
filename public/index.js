// we import the protocol, which contains methods of sending and recieving messages using binary
import {decodePacket, encodePacket} from "./clientProtocol.js";

let kicktarget = 0;

if (localStorage.getItem("playername")) document.getElementById("playernameinput").value = localStorage.getItem("playername");
document.getElementById("playernameinput").addEventListener("change", function(e) {
    localStorage.setItem("playername", document.getElementById("playernameinput").value);
});
if (localStorage.getItem("lobbycode")) document.getElementById("lobbycodeinput").value = localStorage.getItem("lobbycode");
document.getElementById("lobbycodeinput").addEventListener("change", function(e) {
    localStorage.setItem("lobbycode", document.getElementById("lobbycodeinput").value);
});

// our protocol is stored in a json file, so we use async fetching to retrieve it for use
let protocol = null;
async function fetchProtocol() {
    protocol = await (await fetch("./json/protocol.json")).json();
}
await fetchProtocol();

function toggleCorrectness() {
    document.getElementById("markcorrectpopup").classList.remove("hidden");
}

function resetInputs() {
    readyState = 1;
    document.getElementById("wordsubmit").classList.remove("wordsubmitreadystate");
    document.getElementById("wordsubmit").innerText = "Submit";
    while (document.getElementById("hintholder").children.length > 0) {
        document.getElementById("hintholder").lastChild.remove();
    }
    document.getElementById("wordinput").disabled = false;
    document.getElementById("wordinput").value = "";
    document.getElementById("wordinput").classList.remove("correctlyguessed", "incorrectlyguessed");
    document.getElementById("wordinput").removeEventListener("mousedown", toggleCorrectness);
    document.getElementById("wordinput").placeholder = "Type Your Hint";
    document.getElementById("wordsubmit").disabled = false;
    document.getElementById("wordsubmit").classList.remove("nextcardstyle");

    document.getElementById("removewordpopup").classList.add("hidden");
    document.getElementById("markcorrectpopup").classList.add("hidden");
    document.getElementById("kickwindow").classList.add("hidden");
}

// the class used to instantiate our websocket connection, holding our events and how to handle server data
class Socket {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.pingsocket = false;
    }

    // attempts to form a connection with the websocket server (wss), if one doesn't already exist
    connect() {
        if (this.socket !== null) return;
        this.socket = new WebSocket("wss://" + location.host + "/wss");
        this.socket.binaryType = "arraybuffer";
        this.socket.onopen = () => this.open();
        this.socket.onmessage = (data) => this.message(data);
        this.socket.onerror = (error) => this.error(error);
        this.socket.onclose = (reason) => this.close(reason);
    }

    // breaks an existing connection, and sends a close event while removing the socket
    disconnect() {
        if (this.socket === null) return;
        this.socket.close();
        this.socket = null;
        this.connected = false;
    }

    // takes in a constructed binary packet, and sends it to the wss where it decodes the data
    talk(data) {
        if (this.socket === null) return;
        if (this.socket.readyState === 1) this.socket.send(data);
        else setTimeout(() => { this.talk(data) }, 100);
    }

    // when we recieve an encoded packet, we decode it based on the header and execute the appropriate steps
    message(packet) {
        if (this.pingsocket) return;
        let reader = new DataView(packet.data);
        
        switch (reader.getInt8(0)) {
            // the server has confirmed our connection. Log it and toggle our connection status
            case protocol.client.connected: {
                console.log(`Connection confirmed by server on port "${location.host}"`);
                this.connected = true;
                break;
            }
            // our confirmation of a successful host/join
            case protocol.client.lobbyJoined: {
                const d = decodePacket(reader, ["int8", "string", "int8"]);
                console.log(`Lobby ${d[2] ? "hosted" : "joined"} with code ${d[1]}`);
                document.getElementById("findlobbybutton").disabled = true;
                document.getElementById("frontpage").classList.add("hidden");
                document.getElementById("gamepage").classList.remove("hidden");
                document.getElementById("startgamepopup").classList.remove("hidden");
                break;
            }
            // updates the game with all the relevant information
            case protocol.client.update: {
                const d = decodePacket(reader, [
                    "int8", // header
                    "repeat", "string", "string", "int8", "int8", "int8", "int8", "int8", "int8", "int8", "end", // player data
                    "int8", "int8", "string", "int8", "string", // lobby data
                    "repeat", "string", "end", // card history
                    "repeat", "string", "end", // hints
                ]);

                // the player list
                while (document.getElementById("playerlist").children.length > 0) {
                    document.getElementById("playerlist").lastChild.remove();
                }
                for (let i = 0; i < d[1].length; i += 9) {
                    let holder = document.createElement("div");
                    holder.classList.add("playerholder", "center");
                    holder.innerText = d[1][i + 0];
                    if (d[1][i + 2]) {
                        holder.innerText += " 👁";
                        holder.style.color = "var(--grey)";
                    }
                    if (d[1][i + 5]) {
                        holder.innerText += " ☆";
                    }
                    if (d[1][i + 6]) {
                        holder.style.color = "var(--purple)";
                    }
                    if (d[1][i + 4]) {
                        holder.innerText += " ?";
                        holder.style.color = "var(--red)";
                    }
                    holder.addEventListener("click", function(e) {
                        document.getElementById("kickwindow").classList.remove("hidden");
                        kicktarget = i/7;
                    });
                    document.getElementById("playerlist").appendChild(holder);
                }
                document.getElementById("lobbycodeholder").innerText = `Code: ${document.getElementById("lobbycodeinput").value}`;
                document.getElementById("scoreholder").innerText = `Score: ${d[2]}/${d[3]}`;

                // check the game phase for what we show
                switch (d[5]) {
                    // waiting in lobby
                    case 0: {
                        console.log("lobby phase");
                        resetInputs();
                        
                        document.getElementById("startgamepopup").classList.remove("hidden");

                        for (let i = 0; i < d[1].length; i += 9) {
                            if (!d[1][i + 6]) continue;
                            if (d[1][i + 5]) {
                                document.getElementById("startgametext").innerText = "Click to start the game";
                                document.getElementById("startgamebutton").disabled = false;
                            } else {
                                document.getElementById("startgametext").innerText = "Waiting For Host";
                                document.getElementById("startgamebutton").disabled = true;
                            }
                        }
                        break;
                    }
                    // removing words
                    case 1: {
                        console.log("removing phase")
                        resetInputs();

                        document.getElementById("wordholder").innerHTML = `???`;
                        document.getElementById("wordinput").classList.add("hidden");
                        document.getElementById("wordsubmit").classList.add("hidden");
                        document.getElementById("startgamepopup").classList.add("hidden");
                        let guessor = "An Unknown Player";
                        let remover = "An Unknown Player";
                        for (let i = 0; i < d[1].length; i += 9) {
                            if (d[1][i + 4]) guessor = i;
                            if (d[1][i + 8]) remover = i;
                            if (!d[1][i + 6]) continue;
                            if (d[1][i + 8]) {
                                document.getElementById("removewordpopup").classList.remove("hidden");
                            }
                        }
                        document.getElementById("infoholder").innerText = `${d[1][guessor]} is guessing\n${d[1][remover]} is currently removing a word`;
                        break;
                    }
                    // writing
                    case 2: {
                        console.log("writing phase");
                        document.getElementById("startgamepopup").classList.add("hidden");
                        document.getElementById("removewordpopup").classList.add("hidden");
                        let waiting = [];
                        for (let i = 0; i < d[1].length; i += 9) {
                            if (d[1][i + 3]) waiting.push(i);
                            if (d[1][i + 4]) document.getElementById("infoholder").innerText = `${d[1][i + 0]} is guessing\n`;
                            if (!d[1][i + 6]) continue;
                            if (d[1][i + 4]) {
                                document.getElementById("wordinput").classList.add("hidden");
                                document.getElementById("wordsubmit").classList.add("hidden");
                            } else {
                                document.getElementById("wordholder").innerText = d[4];
                                document.getElementById("wordinput").classList.remove("hidden");
                                document.getElementById("wordsubmit").classList.remove("hidden");
                            }
                        }
                        document.getElementById("infoholder").innerText = `Waiting on ${waiting.length} writers`;
                        while (document.getElementById("hintholder").children.length > 0) {
                            document.getElementById("hintholder").lastChild.remove();
                        }
                        for (let i of waiting) {
                            let holder = document.createElement("div");
                            holder.classList.add("hintbox", "center");
                            holder.innerHTML = d[1][i];
                            document.getElementById("hintholder").appendChild(holder);
                        }
                        break;
                    }
                    // filtering
                    case 3: {
                        console.log("removal phase");
                        let guessor = null;
                        let filterer = null;
                        while (document.getElementById("hintholder").children.length > 0) {
                            document.getElementById("hintholder").lastChild.remove();
                        }
                        for (let i = 0; i < d[1].length; i += 9) {
                            if (d[1][i + 4]) guessor = i;
                            if (d[1][i + 7]) filterer = i;
                            if (!d[1][i + 6]) continue;
                            if (d[1][i + 4]) continue;

                            document.getElementById("removewordpopup").classList.remove("hidden");
                            while (document.getElementById("removewordholder").children.length > 1) {
                                document.getElementById("removewordholder").lastChild.remove();
                            }
                            for (let c = 0; c < d[8].length; c += 2) {
                                let holder = document.createElement("div");
                                holder.classList.add(d[8][c][0] === "!" ? "removedword" : "unremovedword");
                                holder.innerText = d[8][c].substring(1);
                                holder.title = d[8][c + 1];
                                holder.addEventListener("click", function(e) {
                                    socket.talk(encodePacket([protocol.server.removeClue, d[8][c]], ["int8", "string"]));
                                });
                                document.getElementById("removewordholder").appendChild(holder);
                            }
                            if (d[1][i + 7]) {
                                let holder = document.createElement("div");
                                holder.classList.add("finishedremovingbutton");
                                holder.innerText = "Send Clues";
                                holder.addEventListener("click", function(e) {
                                    socket.talk(encodePacket([protocol.server.sendClues], ["int8"]));
                                });
                                document.getElementById("removewordholder").appendChild(holder);
                            }
                        }
                        document.getElementById("infoholder").innerText = `${d[1][guessor]} is guessing\n${d[1][filterer]} is filtering the words`;
                        document.getElementById("removewordholdertext").innerText = `${d[1][filterer]} is filtering words`;
                        break;
                    }
                    // guessing
                    case 4: {
                        console.log("guessing phase");
                        document.getElementById("wordinput").classList.remove("hidden");
                        document.getElementById("wordsubmit").classList.remove("hidden");
                        document.getElementById("removewordpopup").classList.add("hidden");
                        document.getElementById("wordinput").placeholder = "Type Your Guess";
                        for (let i = 0; i < d[1].length; i += 9) {
                            if (d[1][i + 4]) document.getElementById("infoholder").innerText = `${d[1][i + 0]} is guessing`;
                            if (!d[1][i + 6]) continue;
                            if (d[1][i + 4]) {
                            } else {
                                document.getElementById("wordinput").disabled = true;
                                document.getElementById("wordsubmit").disabled = true;
                            }
                        }
                        while (document.getElementById("hintholder").children.length > 0) {
                            document.getElementById("hintholder").lastChild.remove();
                        }
                        for (let i = 0; i < d[8].length; i += 2) {
                            let holder = document.createElement("div");
                            holder.classList.add("hintbox", "center");
                            holder.innerHTML = `<span class="hintname">${d[8][i + 1]}</span><br>${d[8][i + 0].substring(1)}`;
                            if (d[8][i + 0].substring(1) === "X") holder.style.color = "red";
                            document.getElementById("hintholder").appendChild(holder);
                        }
                        break;
                    }
                    // wrap up
                    case 5: {
                        console.log("final phase");
                        document.getElementById("infoholder").innerText = `The game is over\n`;

                        if (d[6] === d[4]) {
                            document.getElementById("infoholder").innerText += `The guessor guessed correctly`;
                            document.getElementById("wordinput").classList.add("correctlyguessed");
                        }
                        else {
                            document.getElementById("infoholder").innerText += `The guessor guessed incorrectly`;
                            document.getElementById("wordinput").classList.add("incorrectlyguessed");
                        }

                        document.getElementById("wordholder").innerText = d[4];
                        document.getElementById("wordinput").value = d[6];
                        document.getElementById("wordinput").addEventListener("mousedown", toggleCorrectness);
                        document.getElementById("wordinput").disabled = false;
                        document.getElementById("wordsubmit").disabled = false;
                        document.getElementById("wordsubmit").innerText = "Next Card";
                        document.getElementById("wordsubmit").classList.add("nextcardstyle");
                        break;
                    }
                }
                break;
            }
            // prompts a player to remove a card option
            case protocol.client.removeCard: {
                const d = decodePacket(reader, ["int8", "repeat", "string", "end"]);
                document.getElementById("removewordpopup").classList.remove("hidden");
                while (document.getElementById("removewordholder").children.length > 1) {
                    document.getElementById("removewordholder").lastChild.remove();
                }
                for (let word of d[1]) {
                    let holder = document.createElement("div");
                    holder.classList.add("removableword");
                    holder.innerText = word;
                    holder.addEventListener("click", function(e) {
                        socket.talk(encodePacket([protocol.server.cardRemoved, word], ["int8", "string"]));
                        document.getElementById("removewordpopup").classList.add("hidden");
                    });
                    document.getElementById("removewordholder").appendChild(holder);
                }
                break;
            }
            // tells a player they've been kicked
            case protocol.client.kicked: {
                document.getElementById("disconnectedpopup").classList.remove("hidden");
                break;
            }
            // the server has sent an unknown packet header, due to some error. Log the header of the packet for troubleshooting
            default: {
                console.log(`An unknown code has been recieved: ${reader.getInt8(0)}`);
                break;
            }
        }
    }

    // when we complete a handshake with the wss, we log a quick confirmation
    open() {
        if (!this.pingsocket) console.log("Socket connected");
    }

    // in the case of an error, we directly log the recieved error
    error(error) {
        console.error(error);
    }

    // in the case of the server closing us while still connected, we log the reason and disconnect
    close(reason) {
        if (!this.pingsocket) {
            console.log(`Socket closed for reason:`);
            console.log(reason);
        }
        this.disconnect();
    }
}

// instantiate a socket connection that can be connected and disconnected at will
let socket = new Socket();
socket.connect();

let readyState = 1;
document.getElementById("wordsubmit").addEventListener("click", function(e) {
    readyState *= -1;
    if (readyState === 1) {
        document.getElementById("wordsubmit").classList.remove("wordsubmitreadystate");
        if (!document.getElementById("wordsubmit").classList.contains("nextcardstyle")){
            document.getElementById("wordsubmit").innerText = "Submit";
        }
        socket.talk(encodePacket([protocol.server.submitClue, "", 1], ["int8", "string", "int8"]));
    }
    else {
        document.getElementById("wordsubmit").classList.add("wordsubmitreadystate");
        if (!document.getElementById("wordsubmit").classList.contains("nextcardstyle")){
            document.getElementById("wordsubmit").innerText = "Unsubmit";
        }
        socket.talk(encodePacket([protocol.server.submitClue, document.getElementById("wordinput").value, 0], ["int8", "string", "int8"]));
    }
});
document.getElementById("findlobbybutton").addEventListener("click", function(e) {
    if (document.getElementById("playernameinput").value === "") {
        alert("Please give yourself a name");
        return;
    }
    if (document.getElementById("lobbycodeinput").value === "") {
        alert("Please give the lobby a code");
        return;
    }
    socket.talk(encodePacket(
        [protocol.server.createLobby, document.getElementById("lobbycodeinput").value, document.getElementById("playernameinput").value],
        ["int8", "string", "string"]
    ));
});
document.getElementById("startgamebutton").addEventListener("click", function(e) {
    socket.talk(encodePacket(
        [protocol.server.startGame],
        ["int8"]
    ));
});
document.getElementById("cancelkickbutton").addEventListener("click", function(e) {
    document.getElementById("kickwindow").classList.add("hidden");
});
document.getElementById("kickbutton").addEventListener("click", function(e) {
    document.getElementById("kickwindow").classList.add("hidden");
    socket.talk(encodePacket([protocol.server.kickPlayer, kicktarget], ["int8", "int8"]));
});
document.getElementById("markcorrectbutton").addEventListener("click", function(e) {
    document.getElementById("markcorrectpopup").classList.add("hidden");
    socket.talk(encodePacket([protocol.server.markCorrect], ["int8"]));
});
document.getElementById("cancelmarkcorrectbutton").addEventListener("click", function(e) {
    document.getElementById("markcorrectpopup").classList.add("hidden");
});

document.getElementById("wordinput").addEventListener("input", function(e) {
    if (document.getElementById("wordinput").value.indexOf(" ") !== -1) {
        document.getElementById("wordinput").value = document.getElementById("wordinput").value.replace(/\s/g, '');
    }
});

// for our render hosting, we need to do this to keep the project active
function pingRender() {
    let pingsocket = new Socket();
    pingsocket.connect();
    pingsocket.pingsocket = true;
    setTimeout(function(e) {
        pingsocket.disconnect();
        pingsocket = null;
    }, 1000);
}
setInterval(pingRender, 5 * 60 * 1000);