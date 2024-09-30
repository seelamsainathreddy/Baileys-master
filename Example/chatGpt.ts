import makeWASocket, { AnyMessageContent, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import OpenAI from 'openai'
import NodeCache from 'node-cache'

// Initialize OpenAI client
const client = new OpenAI()

const msgRetryCounterCache = new NodeCache()

const startSock = async() => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
    const sock = makeWASocket({
        auth: state,
        msgRetryCounterCache,
    })

    // Event listener for new messages
    sock.ev.on('messages.upsert', async (m) => {
        console.log(JSON.stringify(m, undefined, 2))

        if (m.type === 'notify') {
            for (const message of m.messages) {
                if (!message.key.fromMe) {
                    const remoteJid = message.key.remoteJid!
                    const text = message.message?.conversation || ''

                    try {
                        // OpenAI API call in the format you requested
                        const response = await client.chat.completions.create({
                            messages: [{ role: 'user', content: text }],
                            model: 'gpt-4o-mini'
                        }).asResponse()

                        // Access the underlying Response object
                        console.log(response.headers.get('x-ratelimit-limit-tokens'))

                        // Get the response data
                        const completion = await response.json()
                        const generatedResponse = completion.choices[0]?.message?.content || 'Sorry, I could not process that.'

                        // Send the generated response back to the sender
                        await sock.sendMessage(remoteJid, { text: generatedResponse })
                    } catch (error) {
                        console.error('Error fetching response from OpenAI:', error)
                        await sock.sendMessage(remoteJid, { text: 'Sorry, something went wrong.' })
                    }
                }
            }
        }
    })

    // Connection update
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) {
                startSock()  // Reconnect on failure
            }
        } else if (connection === 'open') {
            console.log('Connection opened')
        }
    })

    sock.ev.on('creds.update', saveCreds)
}

// Start the WhatsApp bot
startSock()