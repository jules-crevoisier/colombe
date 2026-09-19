<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })
const groups = computed(() => (['Partout', 'Liste', 'Message'] as const).map(scope => ({ scope, items: SHORTCUTS.filter(s => s.scope === scope) })))
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Raccourcis clavier</DialogTitle>
        <DialogDescription>Inactifs pendant la saisie de texte.</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-5">
        <section v-for="g in groups" :key="g.scope">
          <h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{{ g.scope }}</h3>
          <dl class="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2.5 text-sm">
            <template v-for="s in g.items" :key="`${g.scope}-${s.keys}`">
              <dt>{{ s.label }}</dt>
              <dd><kbd class="inline-grid h-6 min-w-6 place-items-center rounded-md border border-line-strong border-b-2 bg-surface-app px-1.5 font-sans text-xs font-semibold">{{ s.keys }}</kbd></dd>
            </template>
          </dl>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
