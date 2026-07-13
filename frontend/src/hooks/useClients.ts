import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClientObligation } from '../types';
import { apiFetchJson } from '../services/api';

const fetchClients = async (): Promise<ClientObligation[]> => {
    return apiFetchJson<ClientObligation[]>('/clients');
};

export const useClients = () => {
    return useQuery({
        queryKey: ['clients'],
        queryFn: fetchClients,
        staleTime: 0,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
    });
};

export const useSaveClient = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, data }: { id?: string | null, data: any }) => {
            const isEdit = !!id;
            const path = isEdit ? `/clients/${id}` : '/clients';
            return apiFetchJson<{ id: string } & any>(path, {
                method: isEdit ? 'PUT' : 'POST',
                body: JSON.stringify(data),
            });
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
            return apiFetchJson(`/clients/${id}`, { method: 'DELETE' });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['clients'] });
        },
    });
};
