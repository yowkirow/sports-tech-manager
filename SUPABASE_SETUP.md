# Supabase Database Setup

## Create the Transactions Table

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/dmmydgioujpablalezsn
2. Click on **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy and paste the following SQL:

```sql
-- Create transactions table
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  details JSONB
);

-- Create an index on date for faster queries
CREATE INDEX idx_transactions_date ON transactions(date DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations (for now, since there's no auth)
-- WARNING: This allows anyone with your URL to read/write data
-- You should implement authentication in the future
CREATE POLICY "Allow all access" ON transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

5. Click **Run** to execute the SQL
6. You should see a success message

## Verify Table Creation

1. Click on **Table Editor** in the left sidebar
2. You should see a `transactions` table listed
3. The table should be empty (0 rows)

## Create the Admin Directory Table

To manage the list of administrators dynamically (valid emails for PIN login), run this SQL:

```sql
-- Create admin directory table
CREATE TABLE admin_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- Enable RLS
ALTER TABLE admin_directory ENABLE ROW LEVEL SECURITY;

-- Allow public read access (so Login page can see who is allowed)
CREATE POLICY "Allow public read" ON admin_directory
  FOR SELECT
  USING (true);

-- Allow authenticated users (Admins) to Insert/Update/Delete
CREATE POLICY "Allow admins to manage" ON admin_directory
  FOR ALL
  USING (auth.role() = 'authenticated');

-- Seed initial data
INSERT INTO admin_directory (email, name) VALUES 
('manager@sportstech.com', 'Manager'),
('admin2@sportstech.com', 'Admin 2'),
('pia.justine@gmail.com', 'Pia');
```
