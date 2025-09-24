<script lang="ts">
    import { onMount } from "svelte";
    import TableBlock from "$lib/blocks/TableBlock.svelte";
    import {
        listAvailableTables,
        discoverTableMetadata,
    } from "$lib/views/discovery.js";
    import type { RestQueryConfig } from "$lib/views/query.js";
    import { queryRunner } from "$lib/views/source.js";

    type TableInfo = { name: string };

    let tables: string[] = $state([]);
    let loadingTables = $state(false);
    let tablesError: string | null = $state(null);

    let selectedTable = $state("");
    let columns: string[] = $state([]);
    let loadingData = $state(false);
    let dataError: string | null = $state(null);
    let items: unknown[] = $state([]);

    async function loadTables() {
        loadingTables = true;
        tablesError = null;
        try {
            const res = await listAvailableTables();
            if (res.success) {
                tables = res.data;
                if (!selectedTable && tables.length > 0) {
                    selectedTable = tables[0];
                }
            } else {
                tablesError = res.error.message;
            }
        } catch (err) {
            tablesError = err instanceof Error ? err.message : "Unknown error";
        } finally {
            loadingTables = false;
        }
    }

    async function loadPreviewForTable(tableName: string) {
        if (!tableName) return;
        loadingData = true;
        dataError = null;
        items = [];
        columns = [];
        try {
            // Discover columns
            const meta = await discoverTableMetadata(tableName);
            if (!meta.success) {
                dataError = meta.error.message;
                return;
            }
            const cols = meta.data.columns.map((c) => c.column_name);
            columns = cols.slice(0, 6);

            // Build alias-first select (alias equals column name)
            const select: Record<string, string> = {};
            for (const c of columns) select[c] = c;

            const config: RestQueryConfig = {
                kind: "rest",
                from: tableName,
                select,
                limit: 20,
                count: "planned",
            };

            const { data, error } = await queryRunner.execute(
                config,
                "preview",
            );
            if (error) {
                dataError = error.message;
                items = [];
            } else {
                items = data ?? [];
            }
        } catch (err) {
            dataError = err instanceof Error ? err.message : "Unknown error";
        } finally {
            loadingData = false;
        }
    }

    function handleChangeTable(e: Event) {
        const value = (e.target as HTMLSelectElement).value;
        selectedTable = value;
        loadPreviewForTable(selectedTable);
    }

    function handleRefresh() {
        loadPreviewForTable(selectedTable);
    }

    onMount(() => {
        loadTables().then(() => {
            if (selectedTable) loadPreviewForTable(selectedTable);
        });
    });
</script>

<div class="space-y-6 p-4">
    <div class="space-y-2">
        <h2 class="text-xl font-semibold">
            Demo: Discovery → Validate → Query → Render
        </h2>
        <p class="text-sm text-muted-foreground">
            Проверьте Supabase клиент, discovery и QueryRunner на живых данных.
        </p>
    </div>

    <div class="flex items-center gap-3">
        <label class="text-sm">Таблица</label>
        <select
            class="border rounded px-2 py-1"
            on:change={handleChangeTable}
            disabled={loadingTables}
        >
            {#if loadingTables}
                <option>Загрузка...</option>
            {:else if tablesError}
                <option disabled>{tablesError}</option>
            {:else if tables.length === 0}
                <option disabled>Нет доступных таблиц</option>
            {:else}
                {#each tables as t}
                    <option value={t} selected={t === selectedTable}>{t}</option
                    >
                {/each}
            {/if}
        </select>
        <button
            class="border rounded px-3 py-1"
            on:click={handleRefresh}
            disabled={!selectedTable || loadingData}>Обновить</button
        >
    </div>

    {#if dataError}
        <div class="text-red-600 text-sm">{dataError}</div>
    {/if}

    <div>
        <TableBlock title={`Предпросмотр: ${selectedTable || ""}`} {items} />
    </div>
</div>
