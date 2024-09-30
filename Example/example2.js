const { WAConnection, MessageType, ButtonsMessage } = require('@adiwajshing/baileys');

async function connectToWhatsApp() {
    const conn = new WAConnection();

    // Event listener for QR code
    conn.on('qr', qr => {
        console.log('Scan this QR code to log in:', qr);
    });

    // Event listener for connection updates
    conn.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            console.log('Connection closed. Reconnecting...');
            connectToWhatsApp(); // Reconnect if closed
        } else if (connection === 'open') {
            console.log('Successfully logged in to WhatsApp!');
            sendButtons(conn);
        }
    });

    // Connect to WhatsApp
    await conn.connect();
}

async function sendButtons(conn) {
    const recipientId = '1234567890@s.whatsapp.net'; // Replace with the recipient's WhatsApp ID

    // Create buttons
    const buttons = [
        { buttonId: 'btn1', buttonText: { displayText: 'Button 1' }, type: 1 },
        { buttonId: 'btn2', buttonText: { displayText: 'Button 2' }, type: 1 },
        { buttonId: 'btn3', buttonText: { displayText: 'Button 3' }, type: 1 }
    ];

    // Create button message
    const buttonMessage = {
        contentText: 'Please choose an option:',
        footerText: 'This is a footer',
        buttons: buttons,
        headerType: 1 // Header type 1 for text
    };

    // Send the button message
    await conn.sendMessage(recipientId, buttonMessage, MessageType.buttonsMessage);
    console.log('Button message sent');
}

// Start the connection
connectToWhatsApp();


