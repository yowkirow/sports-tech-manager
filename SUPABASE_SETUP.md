# Supabase Database Setup

## Atomic Order Editing

The app calls `public.save_order_changes` once per order edit. Install the function
before deploying an app version that uses it:

```powershell
npx supabase db push --linked --project-ref dmmydgioujpablalezsn --skip-vault --dry-run
npx supabase db push --linked --project-ref dmmydgioujpablalezsn --skip-vault
```

The earlier migration files are restored from the project's existing migration
history. The dry run should list only `20260907070000_save_order_changes.sql` on an
existing installation. Using `db push` also records the applied version; do not
repair older versions as reverted or reapply them to bypass missing local history.

The function uses `SECURITY INVOKER`, so existing table grants and row-level
security remain in effect. It locks the complete visible active order in ID order,
checks the original row snapshots and pending-order requirement, and updates all
source rows in a single transaction. Any exception rolls back every item. It does
not insert missing records or fall back to separate client updates.

Pricing edits, quick tracking, return tags, payment/fulfillment updates and comments
all use this operation. A bulk action across several orders is atomic per order,
not across the entire selection.

Customer calls always require a pending order, even if the request disables that
option. Admin calls can edit other statuses. A lost network response can leave the
commit result unknown, so the app asks the user to reload rather than retry blindly.

Run the PostgreSQL regressions with an authenticated Supabase CLI:

```powershell
$env:SUPABASE_DB_TEST_PROJECT_REF = 'dmmydgioujpablalezsn'
node --test tests\orderEditing.database.test.js
```

These regressions wrap the function definition and synthetic fixtures in one
transaction that is always rolled back. They never commit fixture records or
modify existing orders. Ordinary `npm test` skips the database case unless this
environment variable is set.

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

## Create the Activity Logs Table

To track user actions (Audit Trail), run this SQL:

```sql
CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT, -- Optional description or JSON
  entity_id TEXT -- Optional specific ID involved (e.g. Order ID)
);

-- Enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow public read (for admins to see logs)
CREATE POLICY "Allow public read" ON activity_logs FOR SELECT USING (true);

-- Allow authenticated users to insert logs
CREATE POLICY "Allow insert" ON activity_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

## Create the Customers Table

To store repeat customer details, run this SQL:

```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  name TEXT NOT NULL UNIQUE,
  contact_number TEXT,
  address TEXT,
  notes TEXT,
  total_spent NUMERIC DEFAULT 0
);

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Allow public read (for POS search)
CREATE POLICY "Allow public read" ON customers FOR SELECT USING (true);

-- Allow all access for now (or restrict to authenticated if you prefer)
CREATE POLICY "Allow all access" ON customers FOR ALL USING (true) WITH CHECK (true);
```
