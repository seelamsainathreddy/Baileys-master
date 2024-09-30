import OpenAI from 'openai'

const openai = new OpenAI({
	apiKey: 'sk--w1I2q8IU7qRryqygc1mj-yji7Gb-DAyKNoIPJASZfT3BlbkFJr1Li__qoys32kBGdqiEfhBmGFr7K8TVPVaAI86_BwA'
});

let assistantId = "asst_CTp4Fn5dm8AA3bqrQRZLiu4d";

//threads
//create thread
//thread_NL3SC6GjSC7qh8Db6pv8q2zf
//run_iYSzh4Jjlct5HqFtDozxwVL1
//msg_5D0NVGti7WNu2Pkwhbd7q0o1
const thread = await openai.beta.threads.create();
//create message

const message = await openai.beta.threads.messages.create(thread.id, {
    role : "user",
    content : "hi what assistant are you"
} );

const run = openai.beta.threads.runs.stream(thread.id, {
    assistant_id: assistantId
  })
    .on('textCreated', (text) => process.stdout.write('\nassistant > '))
    .on('textDelta', (textDelta, snapshot) => process.stdout.write(textDelta.value))
    .on('toolCallCreated', (toolCall) => process.stdout.write(`\nassistant > ${toolCall.type}\n\n`))
    .on('toolCallDelta', (toolCallDelta, snapshot) => {
      if (toolCallDelta.type === 'code_interpreter') {
        if (toolCallDelta.code_interpreter.input) {
          process.stdout.write(toolCallDelta.code_interpreter.input);
        }
        if (toolCallDelta.code_interpreter.outputs) {
          process.stdout.write("\noutput >\n");
          toolCallDelta.code_interpreter.outputs.forEach(output => {
            if (output.type === "logs") {
              process.stdout.write(`\n${output.logs}\n`);
            }
          });
        }
      }
    });




//run assistant
// const run = await openai.beta.threads.runs.create(thread.id, {
//     assistant_id:assistantId,
//     instructions:"call me as Leon"
// });

// const runRetrive = await openai.beta.threads.runs.retrieve(thread.id, run.id);

// console.log(thread, run, runRetrive, message)


// const messages = await openai.beta.threads.messages.list("thread_NL3SC6GjSC7qh8Db6pv8q2zf")
// let response = '';
// messages.body.data.forEach((message) => {
//     console.log(message.content)
// });

