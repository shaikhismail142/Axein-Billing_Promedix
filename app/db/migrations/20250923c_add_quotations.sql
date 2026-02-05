begin;

-- Quotation master table
create table if not exists quotations (
  id bigserial primary key,             -- integer PK
  quotation_number text not null unique,
  customer_id integer references customers(id) on delete set null,
  quotation_date timestamptz not null default now(),
  valid_until date,
  meta jsonb not null default '{}'::jsonb,   -- {notes, terms, discount, ...}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Quotation line items
create table if not exists quotation_items (
  id bigserial primary key,
  quotation_id bigint not null references quotations(id) on delete cascade,
  product_id integer references products(id) on delete set null,
  description text not null,
  qty numeric(18,3) not null check (qty >= 0),
  price numeric(18,2) not null check (price >= 0),  -- defaults from products.meta.cost_price, editable
  tax numeric(18,2) not null default 0,
  discount numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0
);

create index if not exists idx_quotation_items_qid on quotation_items(quotation_id);
create index if not exists idx_quotations_date on quotations(quotation_date);

-- updated_at trigger
create or replace function trg_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_touch_quotations on quotations;
create trigger trg_touch_quotations
before update on quotations
for each row execute procedure trg_touch_updated_at();

commit;
