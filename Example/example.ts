import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache'
import readline from 'readline'
import makeWASocket, { AnyMessageContent, BinaryInfo, delay, DisconnectReason, encodeWAM, fetchLatestBaileysVersion, getAggregateVotesInPollMessage, makeCacheableSignalKeyStore, makeInMemoryStore, PHONENUMBER_MCC, proto, useMultiFileAuthState, WAMessageContent, WAMessageKey } from '../src'
import MAIN_LOGGER from '../src/Utils/logger'
import open from 'open'
import OpenAI from 'openai'
import fs from 'fs'
import axios from 'axios'
import { text } from 'stream/consumers'
import { default as MessageType, WAMessageStubType } from '@whiskeysockets/baileys'


const openai = new OpenAI({
	apiKey: 'sk--w1I2q8IU7qRryqygc1mj-yji7Gb-DAyKNoIPJASZfT3BlbkFJr1Li__qoys32kBGdqiEfhBmGFr7K8TVPVaAI86_BwA'
});

let assistantId = "asst_CTp4Fn5dm8AA3bqrQRZLiu4d";

//threads
//create thread
//thread_NL3SC6GjSC7qh8Db6pv8q2zf
//run_iYSzh4Jjlct5HqFtDozxwVL1
//msg_5D0NVGti7WNu2Pkwhbd7q0o1

//create message

async function chatWithAssistant(content, sock: unknown, jid: string | null | undefined){


}



const logger = MAIN_LOGGER.child({})
logger.level = 'trace'

const useStore = !process.argv.includes('--no-store')
const doReplies = !process.argv.includes('--no-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')
const useMobile = process.argv.includes('--mobile')

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache()

// Read line interface
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))

// the store maintains the data of the WA connection in memory
// can be written out to a file & read from it
const store = useStore ? makeInMemoryStore({ logger }) : undefined
store?.readFromFile('./baileys_store_multi.json')
// save every 10s
setInterval(() => {
	store?.writeToFile('./baileys_store_multi.json')
}, 10_000)

// start a connection
const startSock = async() => {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	const thread = await openai.beta.threads.create();
	const sock = makeWASocket({
		version,
		logger,
		printQRInTerminal: !usePairingCode,
		mobile: useMobile,
		auth: {
			creds: state.creds,
			/** caching makes the store faster to send/recv messages */
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		msgRetryCounterCache,
		generateHighQualityLinkPreview: true,
		// ignore all broadcast messages -- to receive the same
		// comment the line below out
		// shouldIgnoreJid: jid => isJidBroadcast(jid),
		// implement to handle retries & poll updates
		getMessage,
	})

	store?.bind(sock.ev)

	// Pairing code for Web clients
	if(usePairingCode && !sock.authState.creds.registered) {
		if(useMobile) {
			throw new Error('Cannot use pairing code with mobile api')
		}

		const phoneNumber = await question('Please enter your mobile phone number:\n')
		const code = await sock.requestPairingCode(phoneNumber)
		console.log(`Pairing code: ${code}`)
	}

	// If mobile was chosen, ask for the code
	if(useMobile && !sock.authState.creds.registered) {
		const { registration } = sock.authState.creds || { registration: {} }

		if(!registration.phoneNumber) {
			registration.phoneNumber = await question('Please enter your mobile phone number:\n')
		}

		const libPhonenumber = await import("libphonenumber-js")
		const phoneNumber = libPhonenumber.parsePhoneNumber(registration!.phoneNumber)
		if(!phoneNumber?.isValid()) {
			throw new Error('Invalid phone number: ' + registration!.phoneNumber)
		}

		registration.phoneNumber = phoneNumber.format('E.164')
		registration.phoneNumberCountryCode = phoneNumber.countryCallingCode
		registration.phoneNumberNationalNumber = phoneNumber.nationalNumber
		const mcc = PHONENUMBER_MCC[phoneNumber.countryCallingCode]
		if(!mcc) {
			throw new Error('Could not find MCC for phone number: ' + registration!.phoneNumber + '\nPlease specify the MCC manually.')
		}

		registration.phoneNumberMobileCountryCode = mcc

		async function enterCode() {
			try {
				const code = await question('Please enter the one time code:\n')
				const response = await sock.register(code.replace(/["']/g, '').trim().toLowerCase())
				console.log('Successfully registered your phone number.')
				console.log(response)
				rl.close()
			} catch(error) {
				console.error('Failed to register your phone number. Please try again.\n', error)
				await askForOTP()
			}
		}

		async function enterCaptcha() {
			const response = await sock.requestRegistrationCode({ ...registration, method: 'captcha' })
			const path = __dirname + '/captcha.png'
			fs.writeFileSync(path, Buffer.from(response.image_blob!, 'base64'))

			open(path)
			const code = await question('Please enter the captcha code:\n')
			fs.unlinkSync(path)
			registration.captcha = code.replace(/["']/g, '').trim().toLowerCase()
		}

		async function askForOTP() {
			if (!registration.method) {
				await delay(2000)
				let code = await question('How would you like to receive the one time code for registration? "sms" or "voice"\n')
				code = code.replace(/["']/g, '').trim().toLowerCase()
				if(code !== 'sms' && code !== 'voice') {
					return await askForOTP()
				}

				registration.method = code
			}

			try {
				await sock.requestRegistrationCode(registration)
				await enterCode()
			} catch(error) {
				console.error('Failed to request registration code. Please try again.\n', error)

				if(error?.reason === 'code_checkpoint') {
					await enterCaptcha()
				}

				await askForOTP()
			}
		}

		askForOTP()
	}
	// Function to call ChatGPT
	async function callChatGPT(message) {
		try {
			const response = await axios.post(
				'https://api.openai.com/v1/chat/completions',
				{
					model: 'gpt-4o-mini', // Use GPT-4 or another model of your choice
					messages: [{ role: 'system', content: "You are striclty a grammer teacher and just ask user which topic in grammer to teach and be as a grammer teacher only" },
							{ role: 'user', content: message }
					]
				},
				{
					headers: {
						'Authorization': `Bearer sk--w1I2q8IU7qRryqygc1mj-yji7Gb-DAyKNoIPJASZfT3BlbkFJr1Li__qoys32kBGdqiEfhBmGFr7K8TVPVaAI86_BwA`,
						'Content-Type': 'application/json'
					}
				}
			);
			return response.data.choices[0].message.content;
		} catch (error) {
			console.error('Error calling ChatGPT: ', error.response ? error.response.data : error.message);
			return 'Error contacting ChatGPT';
		}
	}

	function isJidGroup(jid) {
		return jid.endsWith('@g.us');
	}
	
	function isJidUser(jid) {
		return jid.endsWith('@s.whatsapp.net');
	}

	async function sendButtons(sock, jid: string) {

		const buttons = [
			{ buttonId: 'btn1', buttonText: { displayText: 'Button 1' }, type: 1 },
			{ buttonId: 'btn2', buttonText: { displayText: 'Button 2' }, type: 1 },
			{ buttonId: 'btn3', buttonText: { displayText: 'Button 3' }, type: 1 }
		];

		const media = {
			url: 'https://example.com/image.jpg', // Replace with your media URL
			mimetype: 'image/jpeg' // Specify the correct MIME type
		};
		
		const buttonMessage = {
			contentText: 'Please choose an option:',
			footerText: 'This is a footer',
			buttons: buttons,
			headerType: 1,
			imageMessage: media // Include media correctly if needed
		};
		

		const message = {
			buttonsMessage: buttonMessage // Correctly wrap the button message
		};
		await sock.sendMessage(jid, message);
		console.log('Button message sent!');
	}


	const sendMessageWTyping = async(msg: AnyMessageContent, jid: string) => {
		await sock.presenceSubscribe(jid)
		await delay(500)

		await sock.sendPresenceUpdate('composing', jid)
		await delay(2000)

		await sock.sendPresenceUpdate('paused', jid)

		await sock.sendMessage(jid, msg)
	}

	// the process function lets you process all events that just occurred
	// efficiently in a batch
	sock.ev.process(
		// events is a map for event name => event data
		async(events) => {
			// something about the connection changed
			// maybe it closed, or we received all offline message or connection opened
			if(events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect } = update
				if(connection === 'close') {
					// reconnect if not logged out
					if((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
						startSock()
					} else {
						console.log('Connection closed. You are logged out.')
					}
				}
				
				// WARNING: THIS WILL SEND A WAM EXAMPLE AND THIS IS A ****CAPTURED MESSAGE.****
				// DO NOT ACTUALLY ENABLE THIS UNLESS YOU MODIFIED THE FILE.JSON!!!!!
				// THE ANALYTICS IN THE FILE ARE OLD. DO NOT USE THEM.
				// YOUR APP SHOULD HAVE GLOBALS AND ANALYTICS ACCURATE TO TIME, DATE AND THE SESSION
				// THIS FILE.JSON APPROACH IS JUST AN APPROACH I USED, BE FREE TO DO THIS IN ANOTHER WAY.
				// THE FIRST EVENT CONTAINS THE CONSTANT GLOBALS, EXCEPT THE seqenceNumber(in the event) and commitTime
				// THIS INCLUDES STUFF LIKE ocVersion WHICH IS CRUCIAL FOR THE PREVENTION OF THE WARNING
				const sendWAMExample = false;
				if(connection === 'open' && sendWAMExample) {
					/// sending WAM EXAMPLE
					const {
						header: {
							wamVersion,
							eventSequenceNumber,
						},
						events,
					} = JSON.parse(await fs.promises.readFile("./boot_analytics_test.json", "utf-8"))

					const binaryInfo = new BinaryInfo({
						protocolVersion: wamVersion,
						sequence: eventSequenceNumber,
						events: events
					})

					const buffer = encodeWAM(binaryInfo);
					
					const result = await sock.sendWAMBuffer(buffer)
					console.log(result)
				}

				console.log('connection update', update)
			}

			// credentials updated -- save them
			if(events['creds.update']) {
				await saveCreds()
			}

			if(events['labels.association']) {
				console.log(events['labels.association'])
			}


			if(events['labels.edit']) {
				console.log(events['labels.edit'])
			}

			if(events.call) {
				console.log('recv call event', events.call)
			}

			// history received
			if(events['messaging-history.set']) {
				const { chats, contacts, messages, isLatest } = events['messaging-history.set']
				console.log(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest})`)
			}



			// WhatsApp message event
			if (events['messages.upsert']) {
				const upsert = events['messages.upsert'];
				console.log('Received messages ', JSON.stringify(upsert, undefined, 2));

				const messages = upsert?.messages || [];
				for (const messageObj of messages) {
					let text;
					if (messageObj.message?.conversation || messageObj.message?.extendedTextMessage?.text) {
						text = messageObj.message?.conversation || messageObj.message?.extendedTextMessage?.text
					}
					const jid = messageObj.key.remoteJid; // Get sender's WhatsApp ID
					console.log(`Sending ${text} to ${jid}:`);

					if (text && upsert.type=='notify') {
						// Call ChatGPT and get the response

						
						// callChatGPT(text).then(async (gptResponse) => {
						// 	if (jid) {
						// 		// Debugging: Log JID and content
						// 		console.log(`Sending ${text} to ${jid}: ${gptResponse}`);
								
						// 		// Check if the JID is for an individual or a group
						// 		if (isJidUser(jid)) {
						// 			// Send the GPT response back to the user/group
						// 			await sock.sendMessage(jid, { text: gptResponse });
						// 			//sendButtons(sock, jid)
						// 		} else {
						// 			console.error('Invalid JID format:', jid);
						// 		}
						// 	}
						// });

						if (isJidUser(jid) && jid != null){
						const message = await openai.beta.threads.messages.create(thread.id, {
							role : "user",
							content : text
						});
					
						let run = await openai.beta.threads.runs.createAndPoll(
							thread.id,
							{ 
							  assistant_id: assistantId,
							}
						  );

						  if (run.status === 'completed') {
							const messages = await openai.beta.threads.messages.list(
							  run.thread_id
							);
							const message = messages.data[0]
							if (message.content[0].type == 'text')
								await sock.sendMessage(jid, { text: String(message.content[0].text.value) });

							
						  } else {
							console.log(run.status);
						  }
					}
				}
				}
			}

			// sock.ev.on('messages.upsert', async (m) => {
			// 	const message = m.messages[0];
			// 	if (!message.key.fromMe && message?.message?.buttonsResponseMessage) {
			// 		const buttonResponse = message.message.buttonsResponseMessage.selectedButtonId;
			// 		console.log('User clicked:', buttonResponse);

			// 		const jid = message.key.remoteJid;
			// 		// You can reply based on the button ID
			// 		if (jid !=null)
			// 		await sock.sendMessage(jid, { text: `You clicked ${buttonResponse}` });
			// 	}
			// });


			// messages updated like status delivered, message deleted etc.
			if(events['messages.update']) {
				console.log(
					JSON.stringify(events['messages.update'], undefined, 2)
				)

				for(const { key, update } of events['messages.update']) {
					if(update.pollUpdates) {
						const pollCreation = await getMessage(key)
						if(pollCreation) {
							console.log(
								'got poll update, aggregation: ',
								getAggregateVotesInPollMessage({
									message: pollCreation,
									pollUpdates: update.pollUpdates,
								})
							)
						}
					}
				}
			}

			if(events['message-receipt.update']) {
				console.log(events['message-receipt.update'])
			}

			if(events['messages.reaction']) {
				console.log(events['messages.reaction'])
			}

			if(events['presence.update']) {
				console.log(events['presence.update'])
			}

			if(events['chats.update']) {
				console.log(events['chats.update'])
			}

			if(events['contacts.update']) {
				for(const contact of events['contacts.update']) {
					if(typeof contact.imgUrl !== 'undefined') {
						const newUrl = contact.imgUrl === null
							? null
							: await sock!.profilePictureUrl(contact.id!).catch(() => null)
						console.log(
							`contact ${contact.id} has a new profile pic: ${newUrl}`,
						)
					}
				}
			}

			if(events['chats.delete']) {
				console.log('chats deleted ', events['chats.delete'])
			}
		}
	)

	return sock

	async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
		if(store) {
			const msg = await store.loadMessage(key.remoteJid!, key.id!)
			return msg?.message || undefined
		}

		// only if store is present
		return proto.Message.fromObject({})
	}
}

startSock()





  



