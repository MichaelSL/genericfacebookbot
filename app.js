'use strict';

exports.handler = async function(event, context, callback) {
  const request = require('async-request');
  const crypto = require('crypto');
  // App Secret can be retrieved from the App Dashboard
  const APP_SECRET = process.env.MESSENGER_APP_SECRET;

  // Arbitrary value used to validate a webhook
  const VALIDATION_TOKEN = process.env.MESSENGER_VALIDATION_TOKEN;

  // Generate a page access token for your page from the App Dashboard
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;

  // URL where the app is running (include protocol). Used to point to scripts and
  // assets located at this address.
  const SERVER_URL = process.env.SERVER_URL;

  if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
    const error = new Error("Missing config values");
    throw error;
  }

  if(event.queryStringParameters){
    const queryParams = event.queryStringParameters;
    if (queryParams['hub.mode'] === 'subscribe' &&
        queryParams['hub.verify_token'] === VALIDATION_TOKEN) {
      console.log("Validating webhook");
      const response = {
        'body': queryParams['hub.challenge'],
        'statusCode': 200
      };
      return response;
    } else {
      const response = {
        'body': 'Error, wrong validation token',
        'statusCode': 403
      };
      
      return response;
    }
  } else {
    var data = JSON.parse(event.body);

    if (data.object == 'page') {
      // Iterate over each entry
      // There may be multiple if batched
      for (const pageEntry of data.entry) {
        var pageID = pageEntry.id;
        var timeOfEvent = pageEntry.time;
  
        // Iterate over each messaging event
        for (const messagingEvent of pageEntry.messaging) {
          if (messagingEvent.optin) {
            await receivedAuthentication(messagingEvent);
          } else if (messagingEvent.message) {
            await receivedMessage(messagingEvent);
          } else if (messagingEvent.delivery) {
            receivedDeliveryConfirmation(messagingEvent);
          } else if (messagingEvent.postback) {
            await receivedPostback(messagingEvent);
          } else if (messagingEvent.read) {
            receivedMessageRead(messagingEvent);
          } else if (messagingEvent.account_linking) {
            receivedAccountLink(messagingEvent);
          } else {
            console.log("Webhook received unknown messagingEvent: ", messagingEvent);
          }
        }
      }
  
      console.log('Sending 200 back to FB Messenger');
      // Assume all went well.
      //
      // You must send back a 200, within 20 seconds, to let us know you've
      // successfully received the callback. Otherwise, the request will time out.
      const response = {
        'body': 'ok',
        'statusCode': 200
      };
      return response;
    }
  }

  /*
  * Verify that the callback came from Facebook. Using the App Secret from
  * the App Dashboard, we can verify the signature that is sent with each
  * callback in the x-hub-signature field, located in the header.
  *
  * https://developers.facebook.com/docs/graph-api/webhooks#setup
  *
  */
  function verifyRequestSignature(event) {
    var signature = event.headers["x-hub-signature"];

    if (!signature) {
      // For testing, let's log an error. In production, you should throw an
      // error.
      console.error("Couldn't validate the signature.");
    } else {
      var elements = signature.split('=');
      var method = elements[0];
      var signatureHash = elements[1];

      var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                          .update(event)
                          .digest('hex');

      if (signatureHash != expectedHash) {
        throw new Error("Couldn't validate the request signature.");
      }
    }
  }

  /*
  * Authorization Event
  *
  * The value for 'optin.ref' is defined in the entry point. For the "Send to
  * Messenger" plugin, it is the 'data-ref' field. Read more at
  * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
  *
  */
  async function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger'
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
      "through param '%s' at %d", senderID, recipientID, passThroughParam,
      timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    await sendTextMessage(senderID, "Authentication successful");
  }

  /*
  * Message Event
  *
  * This event is called when a message is sent to your page. The 'message'
  * object format can vary depending on the kind of message that was received.
  * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
  *
  * For this example, we're going to echo any text that we get. If we get some
  * special keywords ('button', 'generic', 'receipt'), then we'll send back
  * examples of those bubbles to illustrate the special message bubbles we've
  * created. If we receive a message with an attachment (image, video, audio),
  * then we'll simply confirm that we've received the attachment.
  *
  */
  async function receivedMessage(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    console.log("Received message for user %d and page %d at %d with message:",
      senderID, recipientID, timeOfMessage);
    console.log(JSON.stringify(message));

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
      // Just logging message echoes to console
      console.log("Received echo for message %s and app %d with metadata %s",
        messageId, appId, metadata);
      return;
    } else if (quickReply) {
      var quickReplyPayload = quickReply.payload;
      console.log("Quick reply for message %s with payload %s",
        messageId, quickReplyPayload);

      await sendTextMessage(senderID, "Quick reply tapped");
      return;
    }

    if (messageText) {

      // If we receive a text message, check to see if it matches any special
      // keywords and send back the corresponding example. Otherwise, just echo
      // the text we received.
      switch (messageText.replace(/[^\w\s]/gi, '').trim().toLowerCase()) {
        case 'hello':
        case 'hi':
          await sendHiMessage(senderID);
          break;

        case 'image':
          await requiresServerURL(sendImageMessage, [senderID]);
          break;

        case 'gif':
          await requiresServerURL(sendGifMessage, [senderID]);
          break;

        case 'audio':
          await requiresServerURL(sendAudioMessage, [senderID]);
          break;

        case 'video':
          await requiresServerURL(sendVideoMessage, [senderID]);
          break;

        case 'file':
          await requiresServerURL(sendFileMessage, [senderID]);
          break;

        case 'button':
          await sendButtonMessage(senderID);
          break;

        case 'generic':
          await requiresServerURL(sendGenericMessage, [senderID]);
          break;

        case 'receipt':
          await requiresServerURL(sendReceiptMessage, [senderID]);
          break;

        case 'quick reply':
        await sendQuickReply(senderID);
          break;

        case 'read receipt':
          await sendReadReceipt(senderID);
          break;

        case 'typing on':
          await sendTypingOn(senderID);
          break;

        case 'typing off':
          await sendTypingOff(senderID);
          break;

        case 'account linking':
          await requiresServerURL(sendAccountLinking, [senderID]);
          break;

        default:
          await sendTextMessage(senderID, messageText);
      }
    } else if (messageAttachments) {
      await sendTextMessage(senderID, "Message with attachment received");
    }
  }


  /*
  * Delivery Confirmation Event
  *
  * This event is sent to confirm the delivery of a message. Read more about
  * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
  *
  */
  function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
      messageIDs.forEach(function(messageID) {
        console.log("Received delivery confirmation for message ID: %s",
          messageID);
      });
    }

    console.log("All message before %d were delivered.", watermark);
  }


  /*
  * Postback Event
  *
  * This event is called when a postback is tapped on a Structured Message.
  * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
  *
  */
  async function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload;

    console.log("Received postback for user %d and page %d with payload '%s' " +
      "at %d", senderID, recipientID, payload, timeOfPostback);

    // When a postback is called, we'll send a message back to the sender to
    // let them know it was successful
    await sendTextMessage(senderID, "Postback called");
  }

  /*
  * Message Read Event
  *
  * This event is called when a previously-sent message has been read.
  * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
  *
  */
  function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
      "number %d", watermark, sequenceNumber);
  }

  /*
  * Account Link Event
  *
  * This event is called when the Link Account or UnLink Account action has been
  * tapped.
  * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
  *
  */
  function receivedAccountLink(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    var status = event.account_linking.status;
    var authCode = event.account_linking.authorization_code;

    console.log("Received account link event with for user %d with status %s " +
      "and auth code %s ", senderID, status, authCode);
  }

  /*
  * If users came here through testdrive, they need to configure the server URL
  * in default.json before they can access local resources likes images/videos.
  */
  async function requiresServerURL(next, [recipientId, ...args]) {
    if (SERVER_URL === "to_be_set_manually") {
      var messageData = {
        recipient: {
          id: recipientId
        },
        message: {
          text: `
  We have static resources like images and videos available to test, but you need to update the code you downloaded earlier to tell us your current server url.
  1. Stop your node server by typing ctrl-c
  2. Paste the result you got from running "lt —port 5000" into your config/default.json file as the "serverURL".
  3. Re-run "node app.js"
  Once you've finished these steps, try typing “video” or “image”.
          `
        }
      }

      await callSendAPI(messageData);
    } else {
      await next.apply(this, [recipientId, ...args]);
    }
  }

  async function sendHiMessage(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: `
  Congrats on setting up your Messenger Bot!

  Right now, your bot can only respond to a few words. Try out "quick reply", "typing on", "button", or "image" to see how they work. You'll find a complete list of these commands in the "app.js" file. Anything else you type will just be mirrored until you create additional commands.

  For more details on how to create commands, go to https://developers.facebook.com/docs/messenger-platform/reference/send-api.
        `
      }
    }

    await callSendAPI(messageData);
  }

  /*
  * Send an image using the Send API.
  *
  */
  async function sendImageMessage(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "image",
          payload: {
            url: SERVER_URL + "/assets/rift.png"
          }
        }
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a Gif using the Send API.
  *
  */
  async function sendGifMessage(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "image",
          payload: {
            url: SERVER_URL + "/assets/instagram_logo.gif"
          }
        }
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send audio using the Send API.
  *
  */
  async function sendAudioMessage(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "audio",
          payload: {
            url: SERVER_URL + "/assets/sample.mp3"
          }
        }
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a video using the Send API.
  *
  */
  async function sendVideoMessage(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "video",
          payload: {
            url: SERVER_URL + "/assets/allofus480.mov"
          }
        }
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a file using the Send API.
  *
  */
  async function sendFileMessage(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "file",
          payload: {
            url: SERVER_URL + "/assets/test.txt"
          }
        }
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a text message using the Send API.
  *
  */
  async function sendTextMessage(recipientId, messageText) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: messageText,
        metadata: "DEVELOPER_DEFINED_METADATA"
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a button message using the Send API.
  *
  */
  async function sendButtonMessage(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "This is test text",
            buttons:[{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Trigger Postback",
              payload: "DEVELOPER_DEFINED_PAYLOAD"
            }, {
              type: "phone_number",
              title: "Call Phone Number",
              payload: "+16505551234"
            }]
          }
        }
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a Structured Message (Generic Message type) using the Send API.
  *
  */
  async function sendGenericMessage(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [{
              title: "rift",
              subtitle: "Next-generation virtual reality",
              item_url: "https://www.oculus.com/en-us/rift/",
              image_url: SERVER_URL + "/assets/rift.png",
              buttons: [{
                type: "web_url",
                url: "https://www.oculus.com/en-us/rift/",
                title: "Open Web URL"
              }, {
                type: "postback",
                title: "Call Postback",
                payload: "Payload for first bubble",
              }],
            }, {
              title: "touch",
              subtitle: "Your Hands, Now in VR",
              item_url: "https://www.oculus.com/en-us/touch/",
              image_url: SERVER_URL + "/assets/touch.png",
              buttons: [{
                type: "web_url",
                url: "https://www.oculus.com/en-us/touch/",
                title: "Open Web URL"
              }, {
                type: "postback",
                title: "Call Postback",
                payload: "Payload for second bubble",
              }]
            }]
          }
        }
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a receipt message using the Send API.
  *
  */
  async function sendReceiptMessage(recipientId) {
    // Generate a random receipt ID as the API requires a unique ID
    var receiptId = "order" + Math.floor(Math.random()*1000);

    var messageData = {
      recipient: {
        id: recipientId
      },
      message:{
        attachment: {
          type: "template",
          payload: {
            template_type: "receipt",
            recipient_name: "Peter Chang",
            order_number: receiptId,
            currency: "USD",
            payment_method: "Visa 1234",
            timestamp: "1428444852",
            elements: [{
              title: "Oculus Rift",
              subtitle: "Includes: headset, sensor, remote",
              quantity: 1,
              price: 599.00,
              currency: "USD",
              image_url: SERVER_URL + "/assets/riftsq.png"
            }, {
              title: "Samsung Gear VR",
              subtitle: "Frost White",
              quantity: 1,
              price: 99.99,
              currency: "USD",
              image_url: SERVER_URL + "/assets/gearvrsq.png"
            }],
            address: {
              street_1: "1 Hacker Way",
              street_2: "",
              city: "Menlo Park",
              postal_code: "94025",
              state: "CA",
              country: "US"
            },
            summary: {
              subtotal: 698.99,
              shipping_cost: 20.00,
              total_tax: 57.67,
              total_cost: 626.66
            },
            adjustments: [{
              name: "New Customer Discount",
              amount: -50
            }, {
              name: "$100 Off Coupon",
              amount: -100
            }]
          }
        }
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a message with Quick Reply buttons.
  *
  */
  async function sendQuickReply(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: "What's your favorite movie genre?",
        quick_replies: [
          {
            "content_type":"text",
            "title":"Action",
            "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
          },
          {
            "content_type":"text",
            "title":"Comedy",
            "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
          },
          {
            "content_type":"text",
            "title":"Drama",
            "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
          }
        ]
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a read receipt to indicate the message has been read
  *
  */
  async function sendReadReceipt(recipientId) {
    console.log("Sending a read receipt to mark message as seen");

    var messageData = {
      recipient: {
        id: recipientId
      },
      sender_action: "mark_seen"
    };

    await callSendAPI(messageData);
  }

  /*
  * Turn typing indicator on
  *
  */
  async function sendTypingOn(recipientId) {
    console.log("Turning typing indicator on");

    var messageData = {
      recipient: {
        id: recipientId
      },
      sender_action: "typing_on"
    };

    await callSendAPI(messageData);
  }

  /*
  * Turn typing indicator off
  *
  */
  async function sendTypingOff(recipientId) {
    console.log("Turning typing indicator off");

    var messageData = {
      recipient: {
        id: recipientId
      },
      sender_action: "typing_off"
    };

    await callSendAPI(messageData);
  }

  /*
  * Send a message with the account linking call-to-action
  *
  */
  async function sendAccountLinking(recipientId) {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "Welcome. Link your account.",
            buttons:[{
              type: "account_link",
              url: SERVER_URL + "/authorize"
            }]
          }
        }
      }
    };

    await callSendAPI(messageData);
  }

  /*
  * Call the Send API. The message data goes in the body. If successful, we'll
  * get the message id in a response
  *
  */
  async function callSendAPI(messageData) {
    try{
      console.log('Calling FB...')
      let response = await request(`https://graph.facebook.com/v2.6/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: 'POST',
        data: messageData
      });
      console.log('Response successfull: %s', response.statusCode);
    } catch (e){
      console.log('Response failed: %s', e);
    }
  }
}