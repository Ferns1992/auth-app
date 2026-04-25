# 🔐 Auth Gateway

> **The Ultimate Authentication Gateway** - A modern, secure middleware that intercepts and controls access to your applications with style ✨

![Auth Gateway](https://img.shields.io/badge/Auth%20Gateway-Secure%20Access-blue?style=for-the-badge&logo=shield)
![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=for-the-badge&logo=nodedotjs)
![Docker](https://img.shields.io/badge/Docker-Ready-blue?style=for-the-badge&logo=docker)
![Portainer](https://img.shields.io/badge/Portainer-Ready-13bee7?style=for-the-badge&logo=portainer)
![SQLite](https://img.shields.io/badge/Database-SQLite-lightblue?style=for-the-badge&logo=sqlite)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔑 **Admin Management** | Secure admin panel with default credentials (`admin`/`admin`) |
| 👥 **Multi-User Support** | Create and manage unlimited end-users for application access |
| 📱 **App Registration** | Register unlimited third-party applications to protect |
| 🔗 **Access Control** | Assign specific users to specific applications with one click |
| 📋 **Auth Logging** | Track ALL authentication attempts with IP, timestamp, and status |
| 🌐 **Custom Domain** | Configure custom base URL for auth links (perfect for production) |
| 🐳 **Dockerized** | One-command deployment with Docker Compose on port 4040 |
| 🎨 **Modern UI** | Dark glassmorphism theme with smooth animations |
| 🔒 **24h Sessions** | End-user sessions automatically expire after 24 hours |
| 📋 **One-Click Copy** | Copy auth links and secrets instantly from the admin panel |
| 🔐 **bcrypt Security** | All passwords hashed with bcrypt for maximum security |

---

## 📸 Screenshots

> 📝 **Note**: Add your own screenshots to the `screenshots/` folder and update the paths below

### 🔑 Admin Login
![Admin Login](screenshots/admin-login.png)
> *Modern dark-themed login with glassmorphism effects*

### 📊 Admin Dashboard
![Dashboard](screenshots/dashboard.png)
> *Clean overview of users, apps, and recent auth attempts*

### 👥 User Management
![Users](screenshots/users.png)
> *Create users and assign them to apps with one click*

### 📱 App Management
![Apps](screenshots/apps.png)
> *Register apps, view client secrets, and copy auth links instantly*

### 📋 Authentication Logs
![Logs](screenshots/logs.png)
> *Track every auth attempt with full details*

### 🔐 End-User Login
![User Login](screenshots/user-login.png)
> *Minimalist login page for end-users accessing protected apps*

---

## 🚀 Quick Start

### Option 1: 🐳 Deploy with Docker (Recommended)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/auth-app.git
   cd auth-app
   ```

2. **Start with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

3. **Access the admin panel:**
   ```
   http://localhost:4040/admin/login
   ```
   Default login: `admin` / `admin`

4. **⚠️ IMPORTANT: Change the default admin password immediately!**

---

### Option 2: 🔧 Manual Deployment

1. **Clone and install:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/auth-app.git
   cd auth-app
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Access at:**
   ```
   http://localhost:4040
   ```

---

## 🐳 Docker Deployment Guide

### Basic Docker Run
```bash
docker build -t auth-gateway .
docker run -d -p 4040:4040 -v $(pwd)/data:/usr/src/app/data --name auth-gateway auth-gateway
```

### Using Docker Compose (Recommended)
```bash
docker-compose up -d
```

**Docker Compose file included:**
```yaml
version: '3.8'

services:
  auth-gateway:
    build: .
    ports:
      - "4040:4040"
    volumes:
      - ./data:/usr/src/app/data
    environment:
      - PORT=4040
    restart: unless-stopped
```

---

## 🚀 Portainer Deployment Guide

### Step 1: Access Portainer
Open your Portainer instance at `http://your-server:9000`

### Step 2: Create New Stack
1. Go to **Stacks** → **Add Stack**
2. Name it: `auth-gateway`
3. Select **Web Editor** or **Upload**

### Step 3: Paste This Stack Configuration
```yaml
version: '3.8'

services:
  auth-gateway:
    image: node:alpine
    container_name: auth-gateway
    working_dir: /usr/src/app
    volumes:
      - /your/host/path/auth-app:/usr/src/app
    ports:
      - "4040:4040"
    command: sh -c "npm install && node src/server.js"
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=4040
```

**OR use the included Dockerfile:**
```yaml
version: '3.8'

services:
  auth-gateway:
    build:
      context: https://github.com/YOUR_USERNAME/auth-app.git
    ports:
      - "4040:4040"
    volumes:
      - auth_data:/usr/src/app/data
    restart: unless-stopped
    environment:
      - PORT=4040

volumes:
  auth_data:
```

### Step 4: Deploy
Click **Deploy the Stack** 🎉

### Step 5: Access Your App
```
http://your-server-ip:4040/admin/login
```

---

## 🛠️ Usage Guide

### 1️⃣ Admin Setup
- Login with default credentials (`admin`/`admin`)
- **IMMEDIATELY** change the default password via the dashboard
- Configure your custom domain in **Manage Apps** → **Base URL Setting**

### 2️⃣ Register Protected Apps
1. Go to **Manage Apps** → **Register New App**
2. Enter:
   - **App Name**: Your application's name
   - **Redirect URI**: Where to redirect after auth (e.g., `https://yourapp.com/callback`)
3. Click **Register App**
4. **Copy the auto-generated Auth Link** - this is what you'll use in your app!

### 3️⃣ Create End Users
1. Go to **Manage Users** → **Add New User**
2. Create usernames/passwords for users who need app access

### 4️⃣ Assign Users to Apps
- In the **Manage Users** page, use the dropdown to assign users to specific apps
- Only assigned users can access the protected apps
- Click the ✕ badge to revoke access

### 5️⃣ Configure Custom Domain (Production)
1. Go to **Manage Apps** → **Base URL Setting**
2. Enter your custom domain: `https://auth.yourdomain.com`
3. Click **Save Base URL**
4. All auth links will now use your custom domain!

### 6️⃣ Integrate with Third-Party Apps
In your protected applications, redirect users to the Auth Gateway:

```javascript
// Example: Redirect to Auth Gateway for login
const authUrl = `https://auth.yourdomain.com/auth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI`;
window.location.href = authUrl;
```

**After successful authentication, users are redirected back to:**
```
YOUR_REDIRECT_URI?auth=success&user=username
```

**On failure:**
```
YOUR_REDIRECT_URI?auth=failed&reason=no_access
```

---

## 📊 Database Schema

The app uses SQLite with the following tables:

| Table | Description |
|-------|-------------|
| 👤 `users` | Stores admin and end-user credentials |
| 📱 `apps` | Registered third-party applications |
| 🔗 `user_apps` | Links users to apps they can access |
| 📋 `auth_logs` | Tracks ALL authentication attempts |
| ⚙️ `settings` | Stores configuration (base URL, etc.) |

Database file is stored in `/data/auth-gateway.db` and persists via Docker volume.

---

## 🔐 Security Features

- ✅ **Password Hashing**: All passwords hashed with bcrypt (salt rounds: 10)
- ✅ **Session Management**: Secure sessions with SQLite session store
- ✅ **24-Hour Expiry**: End-user sessions expire after 24 hours
- ✅ **Access Control**: Users can ONLY access apps they're assigned to
- ✅ **Auth Logging**: Every attempt is logged (success/failure, IP, user-agent)
- ✅ **No Public Registration**: Only admin can create users - no public signup

---

## ⚙️ Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | 4040 | Port the app runs on |

**Base URL Configuration:**
Set via admin panel in **Manage Apps** → **Base URL Setting**
- Leave empty for auto-detection (development)
- Set to custom domain for production (e.g., `https://auth.yourdomain.com`)

---

## 📈 Auth Logs

All authentication attempts are logged including:
- ✅ Successful logins (with username and app name)
- ❌ Failed attempts (with reason)
- 🔗 Links (redirect URIs) used for authentication
- 🌐 IP addresses
- 🖥️ User agents
- 🕒 Timestamps

View logs in the admin panel under **Auth Logs**.

---

## 🤝 Contributing

1. Fork the repository 🍴
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request 🎉

---

## 📄 License

MIT License - feel free to use this project for personal or commercial use.

---

## ⚠️ Security Notes

- 🔑 **ALWAYS** change the default admin password immediately after first login
- 🌐 Use HTTPS in production (place behind a reverse proxy like Nginx/Traefik)
- 📋 Regularly review authentication logs for suspicious activity
- 💾 Keep the `data/` folder backed up to preserve user/app data
- 🔒 Don't expose the admin panel to the public internet without authentication

---

## 🛠️ Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite3
- **Auth**: bcryptjs + express-session
- **Frontend**: EJS + Bootstrap 5 + Inter Font
- **Deployment**: Docker + Docker Compose
- **UI**: Dark glassmorphism theme with smooth animations

---

## 📞 Support

- 🐛 **Bug Reports**: [Open an Issue](https://github.com/YOUR_USERNAME/auth-app/issues)
- 💡 **Feature Requests**: [Open an Issue](https://github.com/YOUR_USERNAME/auth-app/issues)
- ⭐ **Like it?** Give it a star on GitHub!

---

<div align="center">

**Made with ❤️ for secure application access control**

[![GitHub stars](https://img.shields.io/github/stars/YOUR_USERNAME/auth-app?style=social)](https://github.com/YOUR_USERNAME/auth-app)
[![GitHub forks](https://img.shields.io/github/forks/YOUR_USERNAME/auth-app?style=social)](https://github.com/YOUR_USERNAME/auth-app)

</div>