-- Add tree_path column to link a solved spot to its compressed tree in Storage.
alter table public.solved_spots
  add column if not exists tree_path text;

-- Allow anon uploads to the solutions bucket (single-user desktop app).
-- Tighten with auth later.
create policy "Allow anon uploads to solutions"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'solutions');

create policy "Allow anon reads from solutions"
on storage.objects for select to anon, authenticated
using (bucket_id = 'solutions');

create policy "Allow anon updates to solutions"
on storage.objects for update to anon, authenticated
using (bucket_id = 'solutions');
