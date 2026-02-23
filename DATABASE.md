# SQLite Database Setup for Electron

## Installation

Install better-sqlite3:

```bash
npm install better-sqlite3
```

For production builds, you may need to rebuild for your target platform:

```bash
npm install --save-dev electron-rebuild
```

## Architecture

This setup follows Electron security best practices:

1. **Main Process** (`main.js`) - Handles all database operations
2. **Preload Script** (`preload.js`) - Safely exposes database API to renderer
3. **Renderer Process** (React) - Uses the exposed API via `window.electronAPI`

## Database Location

The SQLite database is stored in the user data directory:
- macOS: `~/Library/Application Support/llm-ui/database.db`
- Windows: `%APPDATA%/llm-ui/database.db`
- Linux: `~/.config/llm-ui/database.db`

## Usage in React Components

Use the `useDatabase` hook:

```jsx
import { useDatabase } from './hooks/useDatabase'

function MyComponent() {
  const db = useDatabase()

  useEffect(() => {
    if (db.isReady) {
      loadData()
    }
  }, [db.isReady])

  const loadData = async () => {
    const users = await db.getAllUsers()
    // ... use data
  }

  const addUser = async () => {
    await db.createUser('John Doe', 'john@example.com')
  }

  return <div>...</div>
}
```

## Available Database Operations

### Settings
- `db.getSetting(key)` - Get a setting value
- `db.setSetting(key, value)` - Set a setting value

### Users (Example)
- `db.getAllUsers()` - Get all users
- `db.getUserById(id)` - Get user by ID
- `db.createUser(name, email)` - Create new user
- `db.updateUser(id, name, email)` - Update user
- `db.deleteUser(id)` - Delete user

## Adding Your Own Tables

Edit `database.js` and add your schema in the `initDatabase()` function:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS your_table (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field1 TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`)
```

Then add your operations to the `dbOperations` object.

## Production Build

For production, make sure to rebuild native modules:

```bash
npm run build
npx electron-rebuild
```
