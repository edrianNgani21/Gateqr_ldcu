<script lang="ts">
    import AdminSettingsView from '$lib/components/AdminSettingsView.svelte';

    let { data } = $props();
</script>

<AdminSettingsView
    {data}
    userRole="dean"
    showSidebar={true}
    pageTitle="Settings"
    roleLabel="Academic Department Head"
/>
