const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const axios = require('axios');

// Initialize the auth state
const { state, saveState } = useSingleFileAuthState('./auth_info.json');

const startSock = () => {
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                startSock();
            }
        } else if (connection === 'open') {
            console.log('opened connection');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        console.log(JSON.stringify(m, undefined, 2));

        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message) {
            const messageContent = msg.message.conversation || msg.message.extendedTextMessage?.text;

            if (messageContent) {
                const response = await getResponseFromGemini(messageContent);
                await sock.sendMessage(msg.key.remoteJid, { text: response });
            }
        }
    });

    sock.ev.on('creds.update', saveState);

    return sock;
};

startSock();

async function getResponseFromGemini(message) {
    try {
        const response = await axios.post('https://gemini-api-url.com/respond', {
            message: message
        }, {
            headers: {
                'Authorization': 'Bearer YOUR_GEMINI_API_KEY'
            }
        });
        return response.data.reply;
    } catch (error) {
        console.error('Error fetching response from Gemini:', error);
        return 'Sorry, I am having trouble understanding you.';
    }
}
