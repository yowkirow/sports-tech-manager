-- Messenger lead capture and auto-reply management.
-- Run this against the SportsTech Supabase project before enabling the webhook.

create table if not exists public.messenger_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  page_id text not null,
  psid text not null,
  full_name text,
  first_name text,
  last_name text,
  profile_pic_url text,
  phone text,
  email text,
  status text not null default 'new'
    check (status in ('new', 'active', 'qualified', 'order_created', 'closed', 'spam')),
  source text not null default 'facebook_messenger',
  notes text,
  tags text[] not null default '{}',
  last_message_at timestamptz,
  last_message_preview text,
  metadata jsonb not null default '{}'::jsonb,
  unique (page_id, psid)
);

create table if not exists public.messenger_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid not null references public.messenger_leads(id) on delete cascade,
  page_id text not null,
  psid text not null,
  message_id text,
  direction text not null check (direction in ('incoming', 'outgoing')),
  message_type text not null default 'text',
  text text,
  payload jsonb not null default '{}'::jsonb,
  auto_reply_rule_id uuid,
  delivery_status text not null default 'saved',
  unique (message_id, direction)
);

create table if not exists public.auto_reply_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  keywords text[] not null default '{}',
  reply_text text not null,
  priority integer not null default 100,
  is_active boolean not null default true,
  match_type text not null default 'contains' check (match_type in ('contains', 'exact')),
  created_by text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_messenger_leads_status on public.messenger_leads(status);
create index if not exists idx_messenger_leads_last_message_at on public.messenger_leads(last_message_at desc);
create index if not exists idx_messenger_messages_lead_created on public.messenger_messages(lead_id, created_at asc);
create index if not exists idx_auto_reply_rules_active_priority on public.auto_reply_rules(is_active, priority asc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_messenger_leads_updated_at on public.messenger_leads;
create trigger set_messenger_leads_updated_at
before update on public.messenger_leads
for each row execute function public.set_updated_at();

drop trigger if exists set_auto_reply_rules_updated_at on public.auto_reply_rules;
create trigger set_auto_reply_rules_updated_at
before update on public.auto_reply_rules
for each row execute function public.set_updated_at();

alter table public.messenger_leads enable row level security;
alter table public.messenger_messages enable row level security;
alter table public.auto_reply_rules enable row level security;

drop policy if exists "Authenticated users can read messenger leads" on public.messenger_leads;
create policy "Authenticated users can read messenger leads"
on public.messenger_leads for select
using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can manage messenger leads" on public.messenger_leads;
create policy "Authenticated users can manage messenger leads"
on public.messenger_leads for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can read messenger messages" on public.messenger_messages;
create policy "Authenticated users can read messenger messages"
on public.messenger_messages for select
using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can read auto reply rules" on public.auto_reply_rules;
create policy "Authenticated users can read auto reply rules"
on public.auto_reply_rules for select
using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can manage auto reply rules" on public.auto_reply_rules;
create policy "Authenticated users can manage auto reply rules"
on public.auto_reply_rules for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

-- Messenger webhook writes with the service role key from the Edge Function.
-- Do not expose that key to the frontend.
