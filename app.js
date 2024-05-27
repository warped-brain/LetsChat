const AWS = require('aws-sdk');

// Set HTTPS Keep-Alive for the AWS SDK
const https = require('https');
const sslAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 64,
    rejectUnauthorized: true
});
sslAgent.setMaxListeners(0);
AWS.config.update({
    httpOptions: {
        agent: sslAgent
    }
});

const docClient = new AWS.DynamoDB.DocumentClient();
const comprehend = new AWS.Comprehend();
const translate = new AWS.Translate();

const DETECT_SENTIMENT_LANGUAGES = [
    'en', 'es', 'fr', 'de', 'it', 'pt',
    'ar', 'hi', 'ja', 'ko', 'zh', 'zh-TW'
];
const REJECT_MESSAGE = 'Express the message in a positive manner.';
const DEFAULT_LANGUAGE = 'en';

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE;
const TOPICS_TABLE = process.env.TOPICS_TABLE;

// Store translations based on a combination of content and target language
const translations = {};

exports.lambdaHandler = async (event, context) => {
    console.log(event);

    const eventType = event.requestContext.eventType;
    const connectionId = event.requestContext.connectionId;

    const domainName = event.requestContext.domainName;
    const stage = event.requestContext.stage;
    const agma = new AWS.ApiGatewayManagementApi({
        endpoint: domainName + '/' + stage
    });

    try { 
        switch (eventType) {
            case 'CONNECT':
                // Handle new connection (if needed)
                break;
            case 'DISCONNECT':
                await deleteConnection(connectionId);
                break;
            case 'MESSAGE':
                await processMessage(agma, connectionId, event.body);
                break;
            default:
                console.log('Error: Unknown event type ' + eventType);
        }
    } catch (err) {
        console.error('Error handling event:', err); 
        // Additional error handling (e.g., sending an error message to the client)
    }

    return {
        statusCode: 200
    };
};

function removeTags(text) {
    return text.replace(/<[^>]*>/g, '');
}

async function processMessage(agma, connectionId, body) {
    console.log('processMessage', connectionId, body);

    const message = JSON.parse(body);
    message.timestamp = Date.now();
    const action = message.action;
    delete message.action;

    switch (action) {
        case 'message':
            await analyzeMessage(message);
            if (message.reject) {
                await rejectMessage(agma, connectionId, message);
            } else {
                await sendMessageToRoom(agma, connectionId, message);
            }
            break;
        case 'init':
            await initConnection(connectionId, message.room, message.lang);
            await sendRoomMessages(agma, connectionId, message.room, message.lang);
            break;
        default:
            console.log('Error: Unknown action ' + action);
    }
}

async function initConnection(connectionId, room, lang) {
    console.log('initConnection', connectionId, room, lang);
    await docClient.put({
        TableName: CONNECTIONS_TABLE,
        Item: {
            connectionId: connectionId,
            lang: lang,
            room: room
        }
    }).promise();
}

async function sendMessageToRoom(agma, sourceConnectionId, message) {
    console.log('sendMessageToRoom', sourceConnectionId, message);

    const connectionData = await docClient.get({
        TableName: CONNECTIONS_TABLE,
        Key: {
            connectionId: sourceConnectionId
        }
    }).promise();

    if (!connectionData.Item || !('room' in connectionData.Item)) {
        console.log('Error: Connection not found or room not set.');
        return;
    }

    message.room = connectionData.Item.room;

    if (Object.keys(message.topics).length > 0) {
        await updateTopics(message.room, message.topics);
    }

    message.roomTopics = await getTopicsList(message.room); 

    await storeMessage(message);

    const connectionsData = await docClient.query({
        TableName: CONNECTIONS_TABLE,
        IndexName: 'roomIndex',
        KeyConditionExpression: 'room = :room',
        ExpressionAttributeValues: {
            ':room': message.room
        }
    }).promise();

    const translatePromises = connectionsData.Items.map(async ({ connectionId, lang }) => {
        const messageCopy = { ...message }; 
        await translateMessage(messageCopy, lang);
        return sendMessagesToConnection(agma, connectionId, [messageCopy]); 
    });

    await Promise.all(translatePromises);
}

async function translateMessage(message, destLang) {
    console.log('translateMessage', message, destLang);

    if (destLang !== message.lang) {
        const contentKey = `${message.content}-${destLang}`; // Create a unique key
        
        // Check if translation exists in the cache
        if (translations[contentKey]) {
            message.translated = translations[contentKey];
        } else {
            const translateData = await translate.translateText({
                SourceLanguageCode: message.lang,
                TargetLanguageCode: destLang,
                Text: message.content
            }).promise();
            message.translated = translateData.TranslatedText;
            // Store translation in the cache
            translations[contentKey] = message.translated;
        }
        message.destLang = destLang; 
    }
}


async function sendMessagesToConnection(agma, connectionId, messages) {
    console.log('sendMessagesToConnection', connectionId, messages);
    try {
        await agma.postToConnection({
            ConnectionId: connectionId,
            Data: JSON.stringify(messages)
        }).promise();
    } catch (err) {
        if (err.statusCode === 410) { 
            console.log(`Connection ${connectionId} no longer exists. Removing...`);
            await deleteConnection(connectionId);
        } else {
            console.error('Error sending message:', err);
            // Handle other potential errors 
        }
    }
}

async function rejectMessage(agma, connectionId, message) {
    console.log('rejectMessage', connectionId, message);
    const originalLang = message.lang; 
    message.user = 'Negative Sentiment Detected:';
    message.lang = DEFAULT_LANGUAGE; 
    message.content = REJECT_MESSAGE;
    await translateMessage(message, originalLang); 
    await sendMessagesToConnection(agma, connectionId, [message]);
}

async function analyzeMessage(message) {
    console.log('analyzeMessage', message);
    message.user = removeTags(message.user);
    message.content = removeTags(message.content);

    try {
        const languageData = await comprehend.detectDominantLanguage({
            Text: message.content
        }).promise();
        console.log('Language Detection:', languageData);

        message.lang = languageData.Languages.reduce(
            (acc, val) => (val.Score > acc.Score ? val : acc),
            { Score: 0 }
        ).LanguageCode;

        let comprehendLang = message.lang; 
        if (DETECT_SENTIMENT_LANGUAGES.indexOf(message.lang) === -1) {
            await translateMessage(message, DEFAULT_LANGUAGE);
            comprehendLang = DEFAULT_LANGUAGE; 
        }

        const detectParams = {
            LanguageCode: comprehendLang,
            Text: message.translated || message.content 
        };

        const sentimentData = await comprehend.detectSentiment(detectParams).promise();
        console.log('Sentiment Analysis:', sentimentData);
        message.sentiment = sentimentData;
        if (message.sentiment.Sentiment === 'NEGATIVE') {
            message.reject = REJECT_MESSAGE;
        }

        const entitiesData = await comprehend.detectEntities(detectParams).promise();
        console.log('Entity Detection:', entitiesData);
        message.topics = entitiesData.Entities.reduce((acc, val) => {
            acc[val.Text] = (acc[val.Text] || 0) + 1;
            return acc;
        }, {});

        // Remove these if they were added during translation 
        if (message.translated) {
            delete message.translated;
            delete message.destLang;
        }

        console.log('Final message:', message); 

    } catch (err) {
        console.error('Error during message analysis:', err);
        // Consider adding more robust error handling (e.g., fallback logic)
    }
}

async function deleteConnection(connectionId) {
    console.log('deleteConnection', connectionId);
    await docClient.delete({
        TableName: CONNECTIONS_TABLE,
        Key: {
            connectionId: connectionId
        }
    }).promise();
}

async function storeMessage(message) {
    console.log('storeMessage', message);
    await docClient.put({
        TableName: CONVERSATIONS_TABLE,
        Item: message
    }).promise();
}

async function updateTopics(room, topics) {
    console.log('updateTopics', room, topics);

    const updatePromises = Object.entries(topics).map(([topic, count]) => {
        return docClient.update({
            TableName: TOPICS_TABLE,
            Key: {
                room: room,
                topic: topic
            },
            UpdateExpression: 'ADD num :n', 
            ExpressionAttributeValues: {
                ':n': count
            }
        }).promise();
    });

    await Promise.all(updatePromises);
}


async function getTopicsList(room) {
    console.log('getTopicsList', room); 
    const topicsData = await docClient.query({
        TableName: TOPICS_TABLE,
        IndexName: 'numIndex',
        KeyConditionExpression: 'room = :room',
        ExpressionAttributeValues: {
            ':room': room
        },
        ScanIndexForward: false, 
        Limit: 3 
    }).promise();

    return topicsData.Items.map(item => item.topic);
}


async function sendRoomMessages(agma, connectionId, room, destLang) {
    console.log('sendRoomMessages', connectionId, room, destLang);
    const conversationsData = await docClient.query({
        TableName: CONVERSATIONS_TABLE,
        KeyConditionExpression: 'room = :room',
        ExpressionAttributeValues: {
            ':room': room
        }
    }).promise();

    // Translate messages in parallel
    const translatePromises = conversationsData.Items.map(async (message) => {
        await translateMessage(message, destLang);
        return message; 
    });
    const translatedMessages = await Promise.all(translatePromises);

    await sendMessagesToConnection(agma, connectionId, translatedMessages); 
}