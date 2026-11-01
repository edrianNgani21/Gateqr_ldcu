<script lang="ts">
    import AdminSettingsView from '$lib/components/AdminSettingsView.svelte';

    let { data } = $props();
</script>

<AdminSettingsView
    {data}
    userRole="osa"
    showSidebar={true}
    pageTitle="Settings"
/>
