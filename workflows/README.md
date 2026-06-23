# Workflows

This directory stores versioned workflow assets that coordinate background processing.

The product application and Supabase remain the system of record. Workflows must write job status and outputs back to Supabase instead of owning business state.

