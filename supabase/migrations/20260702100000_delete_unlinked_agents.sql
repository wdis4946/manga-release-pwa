do $$
declare
  v_delete_count bigint;
begin
  select count(*)
  into v_delete_count
  from public.agents as agent
  where not exists (
    select 1
    from public.manga_series_agents as series_agent
    where series_agent.agent_id = agent.id
  );

  raise notice 'Deleting % agents that are not linked to any manga_series.', v_delete_count;
end;
$$;

delete from public.agents as agent
where not exists (
  select 1
  from public.manga_series_agents as series_agent
  where series_agent.agent_id = agent.id
);
