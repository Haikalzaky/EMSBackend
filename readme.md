# Backend Documentation


## Prerequisites
Ensure you have the following installed on your system:

- Node.js (v18 or above recommended)
- npm (Node Package Manager)
- A valid `.env` file with database credentials

## File Structure
```plaintext
project-directory/
├── server.js            # Main backend file
├── decrypter.js         # Utility for decryption methods
├── .env                 # Environment variables
├── package.json         # Project metadata and dependencies
```

## Environment Variables
Create a `.env` file in the root directory with the following keys:
```env
DB_USER=YOUR_DATABASE_USER
DB_PASSWORD=YOUR_DATABASE_PASSWORD
DB_SERVER=YOUR_DATABASE_SERVER
DB_DATABASE=YOUR_DATABASE_NAME
```

Install dependencies with:
```bash
npm install
```

## server.js
The `server.js` file is the entry point of the application.

## Running the Application
1. Ensure the `.env` file is properly configured.
2. Start the server:
   ```bash
   npm start
   ```
3. Access the server at `http://localhost:3000`.
