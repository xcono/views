<script lang="ts">
    import TableBlock from "$lib/blocks/TableBlock.svelte";
    import type { RestQueryConfig } from "$lib/views/query.js";
    import { queryRunner } from "$lib/views/source.js";

    type FieldConfig = {
        key: string;
        label: string;
        type: "text" | "number" | "date" | "boolean";
        enabled: boolean;
    };

    let fromTable = $state("");
    let columnsInput = $state(""); // comma-separated: id,name,created_at
    let limit = $state(20);
    let offset = $state(0);

    let running = $state(false);
    let errorMsg: string | null = $state(null);
    let items: unknown[] = $state([]);
    let fields: FieldConfig[] = $state([]);

    function buildAliasFirstSelect(cols: string): Record<string, string> {
        const out: Record<string, string> = {};
        cols.split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((c) => {
                // alias equals column name (dots replaced by _) for nested selects
                const alias = c.replaceAll(".", "_");
                out[alias] = c;
            });
        return out;
    }

    function inferFields(sample: unknown): FieldConfig[] {
        if (!sample || typeof sample !== "object") return [];
        const row = sample as Record<string, unknown>;
        return Object.keys(row).map((key) => ({
            key,
            label: key,
            type: inferType(row[key]),
            enabled: true,
        }));
    }

    function inferType(v: unknown): FieldConfig["type"] {
        if (typeof v === "number") return "number";
        if (typeof v === "boolean") return "boolean";
        if (typeof v === "string") {
            const d = new Date(v);
            if (!isNaN(d.getTime())) return "date";
            return "text";
        }
        if (v instanceof Date) return "date";
        return "text";
    }

    async function runQuery() {
        errorMsg = null;
        items = [];
        fields = [];

        const trimmedCols = columnsInput.trim();
        if (!fromTable || !trimmedCols) {
            errorMsg = "Укажите таблицу и список колонок";
            return;
        }

        const select = buildAliasFirstSelect(trimmedCols);
        const config: RestQueryConfig = {
            kind: "rest",
            from: fromTable,
            select,
            limit,
            offset,
            count: "planned",
        };

        running = true;
        try {
            const { data, error } = await queryRunner.execute(
                config,
                "preview",
            );
            if (error) {
                errorMsg = error.message;
                return;
            }
            items = data ?? [];
            if (items.length > 0) {
                fields = inferFields(items[0]);
            }
        } catch (err) {
            errorMsg = err instanceof Error ? err.message : "Unknown error";
        } finally {
            running = false;
        }
    }

    function getMapping() {
        const enabled = fields.filter((f) => f.enabled);
        return enabled.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
        }));
    }
</script>

<div class="space-y-6 p-4">
    <div class="space-y-2">
        <h2 class="text-xl font-semibold">Query Playground</h2>
        <p class="text-sm text-muted-foreground">
            Введите таблицу и колонки (через запятую). Мы выполним запрос,
            извлечём поля из результата и покажем предпросмотр.
        </p>
    </div>

    <div class="grid gap-3 md:grid-cols-4 items-end">
        <div class="flex flex-col gap-1 md:col-span-1">
            <label class="text-sm" for="from">Таблица</label>
            <input
                id="from"
                class="border rounded px-2 py-1"
                bind:value={fromTable}
                placeholder="public.table_name"
            />
        </div>
        <div class="flex flex-col gap-1 md:col-span-2">
            <label class="text-sm" for="cols">Колонки</label>
            <input
                id="cols"
                class="border rounded px-2 py-1"
                bind:value={columnsInput}
                placeholder="id,name,created_at"
            />
        </div>
        <div class="flex gap-2 md:col-span-1">
            <div class="flex flex-col gap-1 w-1/2">
                <label class="text-sm" for="limit">Limit</label>
                <input
                    id="limit"
                    class="border rounded px-2 py-1"
                    type="number"
                    bind:value={limit}
                    min="1"
                    max="500"
                />
            </div>
            <div class="flex flex-col gap-1 w-1/2">
                <label class="text-sm" for="offset">Offset</label>
                <input
                    id="offset"
                    class="border rounded px-2 py-1"
                    type="number"
                    bind:value={offset}
                    min="0"
                />
            </div>
        </div>
    </div>

    <div class="flex gap-3">
        <button
            class="border rounded px-3 py-1"
            onclick={runQuery}
            disabled={running}>Выполнить</button
        >
    </div>

    {#if errorMsg}
        <div class="text-red-600 text-sm">{errorMsg}</div>
    {/if}

    {#if items.length > 0}
        <div class="space-y-3">
            <h3 class="text-md font-semibold">Настройка полей</h3>
            <div class="grid gap-2 md:grid-cols-3">
                {#each fields as f, i}
                    <div
                        class="flex items-center gap-2 border rounded px-2 py-2"
                    >
                        <input
                            type="checkbox"
                            bind:checked={fields[i].enabled}
                        />
                        <code class="text-xs text-muted-foreground"
                            >{f.key}</code
                        >
                        <input
                            class="border rounded px-2 py-1 text-sm flex-1"
                            bind:value={fields[i].label}
                        />
                        <select
                            class="border rounded px-2 py-1 text-sm"
                            bind:value={fields[i].type}
                        >
                            <option value="text">text</option>
                            <option value="number">number</option>
                            <option value="date">date</option>
                            <option value="boolean">boolean</option>
                        </select>
                    </div>
                {/each}
            </div>
        </div>

        <div class="space-y-2">
            <h3 class="text-md font-semibold">Предпросмотр</h3>
            <TableBlock title="Результат" {items} mapping={getMapping()} />
        </div>
    {/if}
</div>
