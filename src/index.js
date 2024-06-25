/* global SillyTavern */

import { Chess } from 'chess.js';
import { CHESSPIECES } from './pieces';
import '@chrisoakman/chessboardjs/dist/chessboard-1.0.0.min.css';
import '@chrisoakman/chessboardjs/dist/chessboard-1.0.0.min';
import './styles.css';

async function importFromScript(what) {
    const module = await import(/* webpackIgnore: true */'../../../../../script.js');
    return module[what];
}

const generateRaw = await importFromScript('generateRaw');

class ChessGame {
    static gamesLaunched = 0;

    static opponentMovePrompt = "You are a world-renowned chess grandmaster. You are given the representation of a chessboard state using the Forsyth-Edwards Notation (FEN) and Portable Game Notation (PGN), along with the full game history. Select the best possible move from the list in algebraic notation and reply with JUST the move, e.g. 'Nc6'. You are playing as {{color}}.";
    static commentPrompt = "{{char}} played a game of chess against {{user}}. {{user}} played as {{color}} and {{char}} played as {{opponent}}, and {{outcome}}! The final state of the board state in FEN notation: {{fen}}. Write a {{random:witty,playful,funny,quirky,zesty}} comment about the game from {{char}}'s perspective.";

    constructor(color) {
        if (color === 'random') {
            color = Math.random() > 0.5 ? 'white' : 'black';
        }

        this.gameId = `sillytavern-chess-$${Math.random().toString(36).substring(2)}`;
        this.boardId = `chessboard-$${this.gameId}`;
        this.color = color;
        this.game = new Chess();
        this.pgn = '';
        this.gameHistory = [];
    }

    getOpponentIcon() {
        return 'fa-chess-queen';
    }

    getOpponentColor() {
        return this.color === 'white' ? 'black' : 'white';
    }

    getOutcome() {
        if (this.game.isCheckmate()) {
            return `$${this.game.turn() === 'w' ? 'Black' : 'White'} wins by checkmate`;
        }
        else if (this.game.isStalemate()) {
            return 'the game is a stalemate';
        }
        else if (this.game.isDraw()) {
            return 'the game is a draw';
        }
        else if (this.game.isThreefoldRepetition()) {
            return 'the game is a threefold repetition';
        }
        else {
            return 'the game was inconclusive';
        }
    }

    async endGame() {
        const context = SillyTavern.getContext();
        const injectId = `chess-$${Math.random().toString(36).substring(2)}`;

        try {
            const message = context.chat[this.messageIndex];
            message.mes = `[$${context.name1} ($${this.color}) played a game of chess against $${context.name2} ($${this.getOpponentColor()}). Outcome: $${this.getOutcome()}]`;
            this.messageText.textContent = message.mes;
            this.chatMessage.style.order = '';
            const commentPromptText = ChessGame.commentPrompt
                .replace(/{{color}}/gi, this.color)
                .replace(/{{opponent}}/gi, this.getOpponentColor())
                .replace(/{{outcome}}/gi, this.getOutcome())
                .replace(/{{fen}}/gi, this.game.fen());
            const command = `/inject id="$${injectId}" position="chat" depth="0" scan="true" role="system" ephemeral="true" $${commentPromptText} | /trigger await=true`;
            await context.executeSlashCommands(command);
        } finally {
            await context.executeSlashCommands(`/inject id="$${injectId}"`);
            this.gameHistory = [];
        }
    }

    async tryMoveOpponent() {
        if (!this.isOpponentTurn() || this.game.isGameOver()) {
            return;
        }

        const currentFen = this.game.fen();
        const currentPgn = this.game.pgn();
        const availableMoves = this.game.moves();
        const gameHistory = this.formatGameHistory();

        const systemPrompt = ChessGame.opponentMovePrompt
            .replace('{{color}}', this.getOpponentColor().toUpperCase());

        const maxRetries = 3;

        for (let i = 0; i < maxRetries; i++) {
            try {
                const movesString = 'Available moves:' + '\n' + availableMoves.join(', ');
                const prompt = [
                    "Game History:",
                    gameHistory,
                    "Current Position:",
                    `FEN: $${currentFen}`,
                    `PGN: $${currentPgn}`,
                    movesString
                ].join('\n\n');

                const reply = await generateRaw(prompt, '', false, false, systemPrompt);
                const move = this.parseMove(reply);

                if (!move) {
                    throw new Error('Failed to parse move');
                }

                const madeMove = this.game.move(move);
                this.addMoveToHistory(madeMove);

                this.board.position(this.game.fen());
                this.updateStatus();
                return;
            } catch (error) {
                console.error('Failed to generate a move', error);
            }
        }

        console.warn('Chess: Making a random move');
        const randomMove = availableMoves[Math.floor(Math.random() * availableMoves.length)];
        const madeMove = this.game.move(randomMove);
        this.addMoveToHistory(madeMove);

        this.board.position(this.game.fen());
        this.updateStatus();
    }

    parseMove(reply) {
        reply = String(reply).trim();
        const regularMatch = reply.match(/([a-h][1-8]-[a-h][1-8])/g);

        if (regularMatch) {
            return { from: regularMatch[0].split('-')[0], to: regularMatch[0].split('-')[1] };
        }

        const notationMatch = reply.match(/([NBRQK])?([a-h])?([1-8])?(x)?([a-h][1-8])(=[NBRQK])?(\+|#)?$$|^O-O(-O)?/);

        if (notationMatch) {
            return notationMatch[0];
        }

        const availableMoves = this.game.moves();
        for (const move of availableMoves) {
            if (reply.toLowerCase().includes(move.toLowerCase())) {
                return move;
            }
        }

        return null;
    }

    removeGraySquares() {
        document.querySelectorAll(`#$${this.boardId} .square-55d63`).forEach((element) => {
            element.classList.remove('gray');
        });
    }

    graySquare(square) {
        document.querySelector(`#$${this.boardId} .square-$${square}`).classList.add('gray');
    }

    onDragStart(source, piece) {
        if (this.game.isGameOver()) {
            return false;
        }

        this.removeGraySquares();

        if ((this.game.turn() === 'w' && this.color === 'black') ||
            (this.game.turn() === 'b' && this.color === 'white')) {
            return false;
        }
    }

    onDrop(source, target) {
        this.removeGraySquares();

        try {
            const move = this.game.move({
                from: source,
                to: target,
                promotion: 'q'
            });

            this.addMoveToHistory(move);

            this.board.position(this.game.fen());
            this.pgn = this.game.pgn();

            this.updateStatus();
            this.tryMoveOpponent();
        } catch {
            return 'snapback';
        }
    }

    addMoveToHistory(move) {
        this.gameHistory.push({
            color: move.color,
            from: move.from,
            to: move.to,
            piece: move.piece,
            san: move.san,
            fen: this.game.fen(),
            pgn: this.game.pgn()
        });
    }
    
    formatGameHistory() {
        return this.gameHistory.map((move, index) => 
            `Move $${index + 1}:\n` +
            `FEN: $${move.fen}\n` +
            `PGN: $${move.pgn}\n` +
            `$${move.color === 'w' ? 'White' : 'Black'}: $${move.san}`
        ).join('\n\n');
    }

    onMouseoverSquare(square, piece) {
        if (this.game.isGameOver()) {
            return;
        }

        if ((this.game.turn() === 'w' && this.color === 'black') ||
            (this.game.turn() === 'b' && this.color === 'white')) {
            return;
        }

        const moves = this.game.moves({
            square: square,
            verbose: true
        })

        if (moves.length === 0) {
            return;
        }

        this.graySquare(square);

        for (let i = 0; i < moves.length; i++) {
            this.graySquare(moves[i].to);
        }
    }

    onMouseoutSquare(square, piece) {
        this.removeGraySquares();
    }

    onSnapEnd() {
        this.board.position(this.game.fen())
    }

    isOpponentTurn() {
        return (this.game.turn() === 'w' && this.color === 'black') || (this.game.turn() === 'b' && this.color === 'white');
    }

    isUserTurn() {
        return (this.game.turn() === 'w' && this.color === 'white') || (this.game.turn() === 'b' && this.color === 'black');
    }

    updateStatus() {
        if (this.game.isGameOver()) {
            this.opponentStatusText.textContent = 'Game over. Press ✕ to close';
        }
        else if (this.isOpponentTurn()) {
            this.opponentStatusText.textContent = 'Thinking...';
        }
        else if (this.isUserTurn()) {
            this.opponentStatusText.textContent = 'Your turn!';
        }
        else {
            this.opponentStatusText.textContent = '';
        }

        if (this.game.isCheckmate()) {
            this.userStatusText.textContent = `Checkmate! $${this.game.turn() === 'w' ? 'Black' : 'White'} wins`;
        }
        else if (this.game.inCheck()) {
            this.userStatusText.textContent = `$${this.game.turn() === 'w' ? 'White' : 'Black'} is in check`;
        }
        else if (this.game.isStalemate()) {
            this.userStatusText.textContent = 'Game is a stalemate';
        }
        else if (this.game.isDraw()) {
            this.userStatusText.textContent = 'Game is a draw';
        }
        else if (this.game.isThreefoldRepetition()) {
            this.userStatusText.textContent = 'Game is a threefold repetition';
        }
        else {
            this.userStatusText.textContent = '';
        }
    }

    async launch() {
        try {
            ChessGame.gamesLaunched++;
            const context = SillyTavern.getContext();
            context.sendSystemMessage('generic', this.gameId);

            if (Array.isArray(context.chat)) {
                for (const message of context.chat) {
                    if (message.mes === this.gameId) {
                        message.mes = `[$${context.name1} plays a game of chess against $${context.name2}]`;
                        this.messageIndex = context.chat.indexOf(message);
                        break;
                    }
                }
            }

            const chat = document.getElementById('chat');
            const chatMessage = chat.querySelector('.last_mes');
            const messageText = chatMessage.querySelector('.mes_text');

            if (!messageText.textContent.includes(this.gameId)) {
                throw new Error('Could not find the chat message');
            }

            const activeChar = context.characters[context.characterId];
            chatMessage.classList.remove('last_mes');
            messageText.innerHTML = '';
            const container = document.createElement('div');
            container.classList.add('flex-container', 'flexFlowColumn', 'flexGap10', 'chess-game');
            messageText.appendChild(container);

            const topRowContainer = document.createElement('div');
            topRowContainer.classList.add('flex-container', 'justifyContentFlexStart', 'flexGap10', 'alignItemsCenter');
            const opponentAvatarContainer = document.createElement('div');
            opponentAvatarContainer.classList.add('avatar');
            const opponentAvatarImg = document.createElement('img');
            opponentAvatarImg.src = activeChar ? context.getThumbnailUrl('avatar', activeChar?.avatar) : '/img/logo.png';
            opponentAvatarContainer.appendChild(opponentAvatarImg);
            topRowContainer.appendChild(opponentAvatarContainer);
            const opponentNameContainer = document.createElement('h3');
            opponentNameContainer.classList.add('margin0');
            opponentNameContainer.textContent = activeChar?.name || 'SillyTavern';
            topRowContainer.appendChild(opponentNameContainer);
            const opponentChessColor = document.createElement('span');
            opponentChessColor.classList.add('fa-solid', this.getOpponentIcon(), 'fa-xl', `chess-$${this.getOpponentColor()}`);
            topRowContainer.appendChild(opponentChessColor);
            const opponentStatusText = document.createElement('q');
            opponentStatusText.textContent = '';
            topRowContainer.appendChild(opponentStatusText);
            const expander = document.createElement('div');
            expander.classList.add('expander');
            topRowContainer.appendChild(expander);
            const undoButton = document.createElement('button');
            undoButton.title = 'Undo';
            undoButton.classList.add('menu_button', 'menu_button_icon', 'fa-solid', 'fa-undo');
            undoButton.addEventListener('click', () => {
                if (this.isOpponentTurn()) {
                    return;
                }

                this.game.undo();
                this.board.position(this.game.fen());

                this.game.undo();
                this.board.position(this.game.fen());

                this.updateStatus();
                this.tryMoveOpponent();
            });
            topRowContainer.appendChild(undoButton);
            const endGameButton = document.createElement('button');
            endGameButton.title = 'End Game';
            endGameButton.classList.add('menu_button', 'menu_button_icon', 'fa-solid', 'fa-times');
            endGameButton.addEventListener('click', () => {
                this.endGame();
            });
            topRowContainer.appendChild(endGameButton);
            container.appendChild(topRowContainer);

            const chessboardContainer = document.createElement('div');
            chessboardContainer.id = this.boardId;
            chessboardContainer.classList.add('wide100p', 'chessboard');
            container.appendChild(chessboardContainer);
            this.board = new Chessboard(this.boardId, {
                draggable: true,
                dropOffBoard: 'snapback',
                position: this.game.fen(),
                orientation: this.color,
                pieceTheme: (p) => CHESSPIECES[p],
                onDragStart: this.onDragStart.bind(this),
                onDrop: this.onDrop.bind(this),
                onMouseoutSquare: this.onMouseoutSquare.bind(this),
                onMouseoverSquare: this.onMouseoverSquare.bind(this),
                onSnapEnd: this.onSnapEnd.bind(this),
            });

            const selectedUserAvatar = document.querySelector('#user_avatar_block .selected img')?.src;
            const bottomRowContainer = document.createElement('div');
            bottomRowContainer.classList.add('flex-container', 'justifyContentFlexEnd', 'flexGap10', 'alignItemsCenter');
            const userAvatarContainer = document.createElement('div');
            userAvatarContainer.classList.add('avatar');
            const userAvatarImg = document.createElement('img');
            userAvatarImg.src = selectedUserAvatar || '/img/logo.png';
            userAvatarContainer.appendChild(userAvatarImg);
            const userNameContainer = document.createElement('h3');
            userNameContainer.classList.add('margin0');
            userNameContainer.textContent = context.name1;
            const userChessColor = document.createElement('span');
            userChessColor.classList.add('fa-solid', 'fa-chess-king', 'fa-xl', `chess-$${this.color}`);
            const userStatusText = document.createElement('q');
            userStatusText.textContent = '';
            bottomRowContainer.appendChild(userStatusText);
            bottomRowContainer.appendChild(userChessColor);
            bottomRowContainer.appendChild(userNameContainer);
            bottomRowContainer.appendChild(userAvatarContainer);
            container.appendChild(bottomRowContainer);

            const order = (20000 + ChessGame.gamesLaunched).toFixed(0);
            chatMessage.style.order = order;

            chat.scrollTop = chat.scrollHeight;

            this.opponentStatusText = opponentStatusText;
            this.userStatusText = userStatusText;
            this.messageText = messageText;
            this.chatMessage = chatMessage;

            this.updateStatus();
            this.tryMoveOpponent();

            window.addEventListener('resize', () => {
                this.board.resize();
            });
        } catch (error) {
            console.error('Error launching chess game:', error);
        }
    }
}

async function launchChessGame() {
    const context = SillyTavern.getContext();

    const modalBody = document.createElement('div');
    modalBody.classList.add('flex-container', 'flexFlowColumn');

    const modalText1 = document.createElement('div');
    modalText1.textContent = 'Play as:';
    modalBody.appendChild(modalText1);

    const colorSelect = document.createElement('select');
    colorSelect.id = 'chess-color-select';
    colorSelect.classList.add('text_pole');
    const whiteOption = document.createElement('option');
    whiteOption.value = 'white';
    whiteOption.textContent = 'White';
    colorSelect.appendChild(whiteOption);
    const blackOption = document.createElement('option');
    blackOption.value = 'black';
    blackOption.textContent = 'Black';
    colorSelect.appendChild(blackOption);
    const randomOption = document.createElement('option');
    randomOption.value = 'random';
    randomOption.textContent = 'Random';
    colorSelect.appendChild(randomOption);
    modalBody.appendChild(colorSelect);

    colorSelect.value = 'random';

    const result = await context.callPopup(modalBody, 'confirm', '', { okButton: 'Play', cancelButton: 'Cancel' });

    if (!result) {
        return;
    }

    const selectedColor = colorSelect.value;

    const game = new ChessGame(selectedColor);
    return game.launch();
}

function addLaunchButton() {
    const launchButton = document.createElement('div');
    launchButton.id = 'chess-launch';
    launchButton.classList.add('list-group-item', 'flex-container', 'flexGap5');
    launchButton.title = 'Launch Chess Game';
    const chessIcon = document.createElement('i');
    chessIcon.classList.add('fa-solid', 'fa-chess');
    launchButton.appendChild(chessIcon);
    const chessText = document.createElement('span');
    chessText.textContent = 'Play Chess';
    launchButton.appendChild(chessText);

    const extensionsMenu = document.getElementById('extensionsMenu');

    if (!extensionsMenu) {
        throw new Error('Could not find the extensions menu');
    }

    extensionsMenu.appendChild(launchButton);
    launchButton.addEventListener('click', launchChessGame);
}

document.addEventListener('DOMContentLoaded', () => {
    addLaunchButton();

    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.makeLast(event_types.CHAT_CHANGED, () => {
        const { chatMetadata } = SillyTavern.getContext();
        for (const key in chatMetadata) {
            if (/chess-[a-z0-9]+$$/.test(key)) {
                console.log('Removing stuck Chess inject', key);
                delete chatMetadata[key];
            }
        }
    });
});