# Supabase Setup Guide

## Quick Start

1. Create a Supabase project at https://app.supabase.com
2. Copy your credentials:
   - Go to Settings → API
   - Copy the **Project URL**
   - Copy the **publishable/public key** (or legacy anon key if available)
3. Add them to `.env.local`:
   ```
   VITE_SUPABASE_URL=your_project_url
   # If your dashboard only shows the Data API URL, you can also use:
   # VITE_SUPABASE_DATA_API_URL=https://your-project.supabase.co/data/v1
   VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
   # or if you still have a legacy anon key:
   # VITE_SUPABASE_ANON_KEY=your_anon_key
   ```
4. Restart your development server

## Authentication Flow

- **Register**: Creates a new user with email and password
- **Login**: Signs in existing user
- **Logout**: Signs out user and clears session
- **useAuth Hook**: Access user state and auth functions anywhere

## Project Structure

```
src/
├── context/
│   └── AuthContext.jsx       # Authentication context provider
├── hooks/
│   └── useAuth.js            # Custom hook for auth
├── assets/services/
│   └── supabaseclient.js     # Supabase client config
├── assets/Pages/Sing/
│   ├── Login.jsx             # Login page
│   └── Register.jsx          # Register page
```

## Usage Example

```jsx
import { useAuth } from '../hooks/useAuth';

function MyComponent() {
  const { user, login, logout, isAuthenticated } = useAuth();
  
  return (
    <div>
      {isAuthenticated ? (
        <button onClick={logout}>Logout {user.email}</button>
      ) : (
        <p>Please login</p>
      )}
    </div>
  );
}
```

## Database Setup (Optional)

To add user profile storage:

1. Create a `profiles` table in Supabase
2. Add columns: `id`, `username`, `email`, `created_at`
3. Set it to automatically insert on signup

Next step: Add profile management to the app.
