// index.js (Serves as both frontend and backend for Vercel deployment)

// --- Backend (Node.js API with Telegram Bot) ---
const express = require('express');
const admin = require('firebase-admin');
const TelegramBot = require('node-telegram-bot-api');
const app = express();
app.use(express.json());

// Firebase Initialization
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://movie-streaming-webapp-default-rtdb.firebaseio.com/" // Replace with your Firebase Realtime DB URL
});
const db = admin.database();

// Telegram Bot Initialization
const botToken = process.env.TELEGRAM_BOT_TOKEN || '8079488155:AAEt6Gp1lE1UgIx6ylYQUuUKFxD0bko2ilU'; // Replace with your bot token or set in Vercel env
const bot = new TelegramBot(botToken, { polling: true });

// Referral Code Generator
const generateReferralCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// Default Admin Settings
const defaultSettings = {
  minWithdraw: 50,
  referBonus: 20,
  taskPoints: 10,
  withdrawMethods: ['bKash', 'Nagad', 'USDT', 'TRX']
};

// Handle /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  const fullName = `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`;
  const welcomeMessage = `
🌟 *Welcome to Refer & Earn, ${fullName}!* 🌟  
Get ready to earn points by inviting friends and completing exciting tasks!  
✨ *Your journey starts here!*  
Use the Mini App below to begin.  
  `;
  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// API Endpoints
app.post('/api/register', async (req, res) => {
  const { userId, phone, username, photoUrl } = req.body;
  const referralCode = generateReferralCode();
  try {
    await db.ref('users/' + userId).set({
      userId,
      phone: phone || 'Not provided',
      username: username || 'Anonymous',
      photoUrl: photoUrl || '',
      referralCode,
      points: 0,
      referredBy: null,
      withdrawRequests: [],
      completedTasks: []
    });
    res.json({ referralCode });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register' });
  }
});

app.post('/api/refer', async (req, res) => {
  const { userId, phone, username, photoUrl, referralCode } = req.body;
  try {
    const snapshot = await db.ref('users').orderByChild('referralCode').equalTo(referralCode).once('value');
    if (snapshot.exists()) {
      const referrerId = Object.keys(snapshot.val())[0];
      const settings = (await db.ref('settings').once('value')).val() || defaultSettings;
      await db.ref('users/' + userId).set({
        userId,
        phone: phone || 'Not provided',
        username: username || 'Anonymous',
        photoUrl: photoUrl || '',
        referralCode: generateReferralCode(),
        points: 10,
        referredBy: referrerId,
        withdrawRequests: [],
        completedTasks: []
      });
      await db.ref('users/' + referrerId).update({
        points: admin.database.ServerValue.increment(settings.referBonus)
      });
      bot.sendMessage(userId, `🎉 You’ve successfully joined via referral! You earned 10 points.`);
      bot.sendMessage(referrerId, `🎉 Your friend joined using your referral code! You earned ${settings.referBonus} points.`);
      res.json({ message: 'Referral successful' });
    } else {
      res.status(400).json({ error: 'Invalid referral code' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to refer' });
  }
});

app.get('/api/user/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const snapshot = await db.ref('users/' + userId).once('value');
    res.json(snapshot.val() || {});
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.post('/api/task/complete', async (req, res) => {
  const { userId, taskId } = req.body;
  try {
    const settings = (await db.ref('settings').once('value')).val() || defaultSettings;
    const taskSnapshot = await db.ref('tasks/' + taskId).once('value');
    if (!taskSnapshot.exists()) return res.status(400).json({ error: 'Task not found' });
    const userSnapshot = await db.ref('users/' + userId).once('value');
    const user = userSnapshot.val();
    if (user.completedTasks?.includes(taskId)) return res.status(400).json({ error: 'Task already completed' });
    await db.ref('users/' + userId).update({
      points: admin.database.ServerValue.increment(settings.taskPoints),
      completedTasks: [...(user.completedTasks || []), taskId]
    });
    bot.sendMessage(userId, `✅ Task completed! You earned ${settings.taskPoints} points.`);
    res.json({ message: 'Task completed, points added!' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, method, details } = req.body;
  try {
    const settings = (await db.ref('settings').once('value')).val() || defaultSettings;
    const userSnapshot = await db.ref('users/' + userId).once('value');
    const user = userSnapshot.val();
    if (user.points < amount || amount < settings.minWithdraw) {
      return res.status(400).json({ error: 'Insufficient points or below minimum withdraw' });
    }
    const requestId = Date.now().toString();
    await db.ref('users/' + userId).update({
      points: user.points - amount,
      withdrawRequests: [...(user.withdrawRequests || []), { id: requestId, amount, method, details, status: 'Pending', date: new Date().toISOString() }]
    });
    bot.sendMessage(userId, `💸 Withdraw request for ${amount} points submitted! We'll process it soon.`);
    res.json({ message: 'Withdraw request submitted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to request withdraw' });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  const { adminId, minWithdraw, referBonus, taskPoints, withdrawMethods } = req.body;
  if (adminId !== '7442526627') return res.status(403).json({ error: 'Unauthorized' }); // Replace with your Telegram ID
  try {
    await db.ref('settings').set({ minWithdraw, referBonus, taskPoints, withdrawMethods });
    res.json({ message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.post('/api/admin/task', async (req, res) => {
  const { adminId, taskId, taskName, taskLink } = req.body;
  if (adminId !== '7442526627') return res.status(403).json({ error: 'Unauthorized' });
  try {
    await db.ref('tasks/' + taskId).set({ taskName, taskLink });
    res.json({ message: 'Task added' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add task' });
  }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const snapshot = await db.ref('tasks').once('value');
    res.json(snapshot.val() || {});
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Serve React app with Telegram Web App integration
app.get('*', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Refer & Earn - Telegram Mini App</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Arial', sans-serif; }
        body { background: linear-gradient(135deg, #1e3c72, #2a5298); min-height: 100vh; color: #fff; padding: 1rem; }
        .container { background: rgba(255, 255, 255, 0.05); padding: 2rem; border-radius: 20px; max-width: 500px; margin: 0 auto; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3); backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.1); }
        h1 { text-align: center; font-size: 2rem; margin-bottom: 1.5rem; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2); }
        h2 { font-size: 1.5rem; margin: 1.5rem 0 1rem; }
        .profile { text-align: center; margin-bottom: 2rem; }
        .profile-pic { width: 100px; height: 100px; border-radius: 50%; object-fit: cover; border: 3px solid #fff; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2); }
        .username { font-size: 1.2rem; margin-top: 0.5rem; }
        .points { background: rgba(255, 255, 255, 0.1); padding: 0.5rem 1rem; border-radius: 10px; margin-top: 0.5rem; }
        button { width: 100%; padding: 0.8rem; margin: 0.5rem 0; border: none; border-radius: 10px; background: linear-gradient(90deg, #ff6b6b, #ff8e53); color: #fff; font-weight: bold; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
        button:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(255, 107, 107, 0.4); }
        input, select { width: 100%; padding: 0.8rem; margin: 0.5rem 0; border: none; border-radius: 10px; background: rgba(255, 255, 255, 0.1); color: #fff; outline: none; transition: background 0.2s; }
        input:focus, select:focus { background: rgba(255, 255, 255, 0.2); }
        .referral-code { background: rgba(255, 255, 255, 0.15); padding: 0.5rem; border-radius: 10px; margin-top: 0.5rem; text-align: center; }
        .task-list .task { background: rgba(0, 0, 0, 0.2); padding: 1rem; margin: 0.5rem 0; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; }
        .task a { color: #ff6b6b; text-decoration: none; margin-right: 1rem; }
        .withdraw-form, .admin-panel { margin-top: 2rem; }
        .admin-panel { background: rgba(0, 0, 0, 0.3); padding: 1.5rem; border-radius: 15px; }
        .stats { display: flex; justify-content: space-around; margin: 1rem 0; background: rgba(255, 255, 255, 0.1); padding: 1rem; border-radius: 10px; }
        .message { text-align: center; margin-top: 1rem; color: #ff6b6b; }
        @media (max-width: 600px) { .container { padding: 1.5rem; max-width: 100%; } h1 { font-size: 1.8rem; } .profile-pic { width: 80px; height: 80px; } }
      </style>
    </head>
    <body>
      <div id="root"></div>
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <script>
        const { useState, useEffect } = React;

        const App = () => {
          const [userId, setUserId] = useState('');
          const [phone, setPhone] = useState('');
          const [username, setUsername] = useState('');
          const [photoUrl, setPhotoUrl] = useState('');
          const [referralCode, setReferralCode] = useState('');
          const [user, setUser] = useState(null);
          const [tasks, setTasks] = useState({});
          const [message, setMessage] = useState('');
          const [withdrawAmount, setWithdrawAmount] = useState('');
          const [withdrawMethod, setWithdrawMethod] = useState('');
          const [withdrawDetails, setWithdrawDetails] = useState('');
          const [settings, setSettings] = useState(${JSON.stringify(defaultSettings)});
          const [newTaskName, setNewTaskName] = useState('');
          const [newTaskLink, setNewTaskLink] = useState('');

          useEffect(() => {
            if (window.Telegram && window.Telegram.WebApp) {
              const tg = window.Telegram.WebApp;
              tg.ready();
              const initData = tg.initDataUnsafe;
              const telegramUser = initData.user || {};
              setUserId(telegramUser.id ? telegramUser.id.toString() : '');
              setPhone(telegramUser.phone_number || '');
              setUsername(telegramUser.username || telegramUser.first_name || 'Anonymous');
              setPhotoUrl(telegramUser.photo_url || 'https://via.placeholder.com/100');
              if (telegramUser.id) fetchUser(telegramUser.id.toString());
              fetchTasks();
              fetchSettings();
            }
          }, []);

          const fetchUser = async (id) => {
            const res = await fetch('/api/user/' + id);
            const data = await res.json();
            setUser(data);
          };

          const fetchTasks = async () => {
            const res = await fetch('/api/tasks');
            const data = await res.json();
            setTasks(data);
          };

          const fetchSettings = async () => {
            const res = await fetch('/api/settings');
            const data = await res.json();
            if (data) setSettings(data);
          };

          const register = async () => {
            const res = await fetch('/api/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, phone, username, photoUrl })
            });
            const data = await res.json();
            if (data.referralCode) {
              setUser({ userId, phone, username, photoUrl, referralCode: data.referralCode, points: 0, withdrawRequests: [], completedTasks: [] });
              setMessage('Registered successfully!');
            } else {
              setMessage(data.error);
            }
          };

          const refer = async () => {
            const res = await fetch('/api/refer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, phone, username, photoUrl, referralCode })
            });
            const data = await res.json();
            setMessage(data.message || data.error);
            if (data.message) fetchUser(userId);
          };

          const completeTask = async (taskId) => {
            const res = await fetch('/api/task/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, taskId })
            });
            const data = await res.json();
            setMessage(data.message || data.error);
            if (data.message) fetchUser(userId);
          };

          const requestWithdraw = async () => {
            const res = await fetch('/api/withdraw', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, amount: parseInt(withdrawAmount), method: withdrawMethod, details: withdrawDetails })
            });
            const data = await res.json();
            setMessage(data.message || data.error);
            if (data.message) {
              fetchUser(userId);
              setWithdrawAmount('');
              setWithdrawDetails('');
            }
          };

          const updateSettings = async () => {
            const res = await fetch('/api/admin/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adminId: userId, ...settings })
            });
            const data = await res.json();
            setMessage(data.message || data.error);
          };

          const addTask = async () => {
            const taskId = Date.now().toString();
            const res = await fetch('/api/admin/task', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adminId: userId, taskId, taskName: newTaskName, taskLink: newTaskLink })
            });
            const data = await res.json();
            setMessage(data.message || data.error);
            if (data.message) {
              fetchTasks();
              setNewTaskName('');
              setNewTaskLink('');
            }
          };

          const isAdmin = userId === 'YOUR_ADMIN_TELEGRAM_ID'; // Replace with your Telegram ID

          return (
            <div className="container">
              <h1>Refer & Earn</h1>
              {userId ? (
                !user ? (
                  <>
                    <div className="profile">
                      <img src={photoUrl} alt="Profile" className="profile-pic" />
                      <div className="username">@{username}</div>
                    </div>
                    <button onClick={register}>Register</button>
                    <input
                      type="text"
                      placeholder="Enter referral code (optional)"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value)}
                    />
                    <button onClick={refer}>Join with Referral</button>
                  </>
                ) : (
                  <>
                    <div className="profile">
                      <img src={user.photoUrl} alt="Profile" className="profile-pic" />
                      <div className="username">@{user.username}</div>
                      <div className="points">Points: {user.points || 0}</div>
                    </div>

                    <div className="stats">
                      <div>Referrals: {user.referredBy ? 1 : 0}</div>
                      <div>Tasks: {user.completedTasks?.length || 0}</div>
                      <div>Withdraws: {user.withdrawRequests?.length || 0}</div>
                    </div>

                    <div>Your Referral Code: <span className="referral-code">{user.referralCode}</span></div>

                    <h2>Tasks</h2>
                    <div className="task-list">
                      {Object.entries(tasks).map(([taskId, task]) => (
                        <div key={taskId} className="task">
                          <span>{task.taskName}</span>
                          <div>
                            <a href={task.taskLink} target="_blank">Join</a>
                            {!user.completedTasks?.includes(taskId) && (
                              <button onClick={() => completeTask(taskId)}>Complete ({settings.taskPoints} pts)</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <h2>Withdraw</h2>
                    <div className="withdraw-form">
                      <input
                        type="number"
                        placeholder={\`Min: \${settings.minWithdraw} points\`}
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                      />
                      <select value={withdrawMethod} onChange={(e) => setWithdrawMethod(e.target.value)}>
                        <option value="">Select Method</option>
                        {settings.withdrawMethods.map(method => (
                          <option key={method} value={method}>{method}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Payment Details"
                        value={withdrawDetails}
                        onChange={(e) => setWithdrawDetails(e.target.value)}
                      />
                      <button onClick={requestWithdraw}>Request Withdraw</button>
                    </div>

                    {isAdmin && (
                      <div className="admin-panel">
                        <h2>Admin Panel</h2>
                        <input
                          type="number"
                          placeholder="Min Withdraw"
                          value={settings.minWithdraw}
                          onChange={(e) => setSettings({ ...settings, minWithdraw: parseInt(e.target.value) })}
                        />
                        <input
                          type="number"
                          placeholder="Refer Bonus"
                          value={settings.referBonus}
                          onChange={(e) => setSettings({ ...settings, referBonus: parseInt(e.target.value) })}
                        />
                        <input
                          type="number"
                          placeholder="Task Points"
                          value={settings.taskPoints}
                          onChange={(e) => setSettings({ ...settings, taskPoints: parseInt(e.target.value) })}
                        />
                        <input
                          type="text"
                          placeholder="Withdraw Methods (comma-separated)"
                          value={settings.withdrawMethods.join(',')}
                          onChange={(e) => setSettings({ ...settings, withdrawMethods: e.target.value.split(',') })}
                        />
                        <button onClick={updateSettings}>Update Settings</button>

                        <h3>Add Task</h3>
                        <input
                          type="text"
                          placeholder="Task Name"
                          value={newTaskName}
                          onChange={(e) => setNewTaskName(e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="Task Link"
                          value={newTaskLink}
                          onChange={(e) => setNewTaskLink(e.target.value)}
                        />
                        <button onClick={addTask}>Add Task</button>
                      </div>
                    )}
                  </>
                )
              ) : (
                <p>Loading Telegram data...</p>
              )}
              {message && <p className="message">{message}</p>}
            </div>
          );
        };

        ReactDOM.render(<App />, document.getElementById('root'));
      </script>
    </body>
    </html>
  `);
});

module.exports = app;
