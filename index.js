const SUPPORTED_LANGUAGES = {
    ar: 'Arabic',
    zh: 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)',
    cs: 'Czech',
    da: 'Danish',
    nl: 'Dutch',
    en: 'English',
    fi: 'Finnish',
    fr: 'French',
    de: 'German',
    el: 'Greek',
    he: 'Hebrew',
    hi: 'Hindi',
    hu: 'Hungarian',
    id: 'Indonesian',
    it: 'Italian',
    ja: 'Japanese',
    ko: 'Korean',
    ms: 'Malay',
    no: 'Norwegian',
    fa: 'Persian',
    pl: 'Polish',
    pt: 'Portuguese',
    ro: 'Romanian',
    ru: 'Russian',
    es: 'Spanish',
    sv: 'Swedish',
    th: 'Thai',
    tr: 'Turkish',
    uk: 'Ukrainian',
    ur: 'Urdu',
    vi: 'Vietnamese'
};

const DEFAULT_LANGUAGE = 'en';

const roomInfo = document.getElementById('room-info');
const chat = document.getElementById('chat');
const controls = document.getElementById('controls');

const urlParams = new URLSearchParams(window.location.search);
let room = urlParams.get('room');
let user = urlParams.get('user');
let lang = urlParams.get('lang');

let connection;

function setupChooseLanguage() {
    const langSection = document.createElement('div');
    langSection.id = 'lang-section'; 

    const langSelect = document.createElement('select');
    langSelect.id = 'lang-select';
    for (let l in SUPPORTED_LANGUAGES) {
        const option = document.createElement('option');
        option.value = l;
        option.text = SUPPORTED_LANGUAGES[l];
        if (l === lang || (lang === null && l === DEFAULT_LANGUAGE)) {
            option.selected = 'selected';
        }
        langSelect.appendChild(option);
    }

    const langLabel = document.createElement('label');
    langLabel.htmlFor = 'lang-select';
    langLabel.textContent = 'Translate to:';

    langSection.appendChild(langLabel);
    langSection.appendChild(langSelect);
    controls.appendChild(langSection);
}

function getConfig() {
    controls.innerHTML = `
        <form id="start-form">
            <div>
                <label for='user'>User:</label>
                <input type='text' id='user'/>
            </div>
            <div>
                <label for='room'>Room:</label>
                <input type='text' id='room'/>
            </div> 
            <button type='submit' id='start-button'>Start</button>
        </form>
    `;

    setupChooseLanguage();

    const roomText = document.getElementById('room');
    const userText = document.getElementById('user');

    if (user !== null) {
        userText.value = user;
    }

    if (room !== null) {
        roomText.value = room;
    }

    document.getElementById('start-form').addEventListener('submit', (evt) => {
        evt.preventDefault();
        const langSelect = document.getElementById('lang-select');
        const langSelected = langSelect.options[langSelect.selectedIndex].value;
        let href = 'index.html?';
        if (userText.value) {
            href += 'user=' + userText.value + '&';
        }
        if (roomText.value) {
            href += 'room=' + roomText.value + '&';
        }
        href += 'lang=' + langSelected;
        window.location.href = href;
    });
}

function startChat(wssUri) {
    controls.innerHTML = `
        <form id="send-form">
            <input type="text" id="send-text" placeholder="Enter your message..."/>
            <button type="submit">Send</button>
        </form>
    `;

    setupChooseLanguage();

    document.getElementById('lang-section').addEventListener('change', () => {
        const langSelect = document.getElementById('lang-select');
        const langSelected = langSelect.options[langSelect.selectedIndex].value;
        window.location.href = 'index.html?user=' + user + '&room=' + room + '&lang=' + langSelected;
    });

    connection = new WebSocket(wssUri);

    connection.onopen = () => {
        console.log('WebSocket open');
        updateRoomInfo();
        chat.innerHTML = ''; 
        sendMessage({ action: 'init', lang: lang, room: room });
    };

    connection.onerror = (error) => {
        console.log('WebSocket error', error);
    };

    connection.onmessage = (message) => {
        const messages = JSON.parse(message.data);
        for (let m of messages) {
            appendMessage(m);
        }
    };

    connection.onclose = (evt) => {
        console.log('WebSocket close');
        if (evt.code != 1000 && navigator.onLine) {
            init(); 
        }
    };

    document.getElementById('send-form').addEventListener('submit', (evt) => {
        evt.preventDefault();
        const sendText = document.getElementById('send-text');
        const content = sendText.value.trim();
        if (content !== '') {
            sendText.value = '';
            sendMessage({ action: 'message', user: user, content: content });
        }
    });
}

function appendMessage(m) {
    let date = new Date(m.timestamp).toLocaleString().toLowerCase();
    let messageDiv = document.createElement('p'); 

    let userSpan = document.createElement('strong');
    userSpan.textContent = removeTags(m.user);
    messageDiv.appendChild(userSpan);

    let timestampSpan = document.createElement('em');
    timestampSpan.textContent = ' ' + date;
    messageDiv.appendChild(timestampSpan);

    if (Object.keys(m.topics).length > 0) {
        let topicsSpan = document.createElement('span');
        topicsSpan.textContent = ' [' + Object.keys(m.topics).join(', ') + ']';
        messageDiv.appendChild(topicsSpan);
    }

    let contentP = document.createElement('p');
    contentP.textContent = '[' + m.lang + '] ' + removeTags(m.content);
    console.log(removeTags(m.content));
    messageDiv.appendChild(contentP);

    if ('translated' in m) {
        let translatedP = document.createElement('p');
        translatedP.textContent = '[' + m.destLang + '] ' + m.translated;
        messageDiv.appendChild(translatedP);
    }

    chat.appendChild(messageDiv);

    if (m.roomTopics) {
        updateRoomInfo(m.roomTopics);
    }

    chat.scrollTop = chat.scrollHeight; 
}

function updateRoomInfo(topicsList) {
    let html = `<h2>${user} [${lang}] @ ${room}`;
    if (topicsList) {
        html += ` [${topicsList.join(', ')}]`;
    }
    html += '</h2>';
    roomInfo.innerHTML = html;
}

function sendMessage(message) {
    const rawMessage = JSON.stringify(message);
    console.log('sendMessage: ' + rawMessage);
    connection.send(rawMessage);
}

function removeTags(text) {
    return text.replace(/<[^>]*>/g, '');
}

function init() {
    if (user !== null && room !== null && lang !== null) {
        fetch('./wss-uri.txt')
            .then(response => response.text())
            .then(wssUri => {
                startChat(wssUri);
            });
    } else {
        getConfig();
    }
}

init();