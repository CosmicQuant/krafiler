import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClientObligation } from '../types';

const fetchClients = async (): Promise<ClientObligation[]> => {
    const res = await fetch('/api/clients');
    if (!res.ok) {
        throw new Error('Failed to load clients from database.');
    }
    return res.json();
};

export const useClients = () => {
    return useQuery({
        queryKey: ['clients'],
        queryFn: fetchClients,
    });
};

export const useSaveClient = () => {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: async ({ id, data }: { id?: string | null, data: any }) => {
            const isEdit = !!id;
            const url = isEdit ? `/api/clients/${id}` : '/api/clients';
            const res = await fetch(url, {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            
            if (!res.ok) {
                const errorPayload = await res.json().catch(async () => ({
                    error: await res.text().catch(() => 'Failed to save client.'),
                }));
                throw new Error(errorPayload.message || errorPayload.error || 'Failed to save client.');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['clients'] });
        },
    });
};

export const useDeleteClient = () => {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                const errorPayload = await res.json().catch(async () => ({
                    error: await res.text().catch(() => 'Failed to delete client.'),
                }));
                throw new Error(errorPayload.message || errorPayload.error || 'Failed to delete client.');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['clients'] });
        },
    });
};
