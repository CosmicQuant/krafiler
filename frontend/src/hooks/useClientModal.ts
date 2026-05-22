import { useState } from 'react';
import { useUIStore } from '../store/uiStore';
import { useSaveClient } from './useClients';
import { ClientObligation } from '../types';
import { normalizeClientObligation } from '../utils/dashboardUtils';

export function useClientModal(
  setDashboardNotice: React.Dispatch<
    React.SetStateAction<{
      tone: 'success' | 'error' | 'info';
      message: string;
    } | null>
  >,
  uploadMasterCsv: (
    clientId: string,
    file: File,
    options?: { propagateError?: boolean },
  ) => Promise<unknown>,
) {
  const { showNewClientModal, setShowNewClientModal } = useUIStore();
  const saveClientMutation = useSaveClient();
  const isSavingClient = saveClientMutation.isPending;

  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [newClientObligations, setNewClientObligations] = useState<string[]>([]);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPin, setNewClientPin] = useState('');
  const [newClientPassword, setNewClientPassword] = useState('');
  const [newClientMasterCsv, setNewClientMasterCsv] = useState<File | null>(null);
  const [newClientModalError, setNewClientModalError] = useState<string | null>(null);

  const resetNewClientForm = () => {
    setEditingClientId(null);
    setShowNewClientModal(false);
    setNewClientName('');
    setNewClientPin('');
    setNewClientPassword('');
    setNewClientObligations([]);
    setNewClientMasterCsv(null);
    setNewClientModalError(null);
  };

  const openNewClientModal = (clientToEdit?: ClientObligation) => {
    setNewClientMasterCsv(null);

    if (clientToEdit?.id) {
      setEditingClientId(Number(clientToEdit.id));
      setNewClientName(clientToEdit.name);
      setNewClientPin(clientToEdit.pin);
      setNewClientPassword(clientToEdit.password || '');
      setNewClientObligations(
        clientToEdit.obligations
          ? clientToEdit.obligations
              .split(',')
              .map((s: string) => normalizeClientObligation(s))
              .filter(Boolean)
          : [],
      );
    } else {
      setEditingClientId(null);
      setNewClientName('');
      setNewClientPin('');
      setNewClientPassword('');
      setNewClientObligations([]);
    }
    setNewClientModalError(null);
    setShowNewClientModal(true);
  };

  const handleSaveClient = async () => {
    if (isSavingClient) {
      return;
    }

    const name = newClientName.trim();
    const pin = newClientPin.trim().toUpperCase();
    const password = newClientPassword.trim();

    if (!name || !pin || !password) {
      setNewClientModalError('Client name, KRA PIN, and KRA password are required before saving.');
      return;
    }

    setNewClientModalError(null);

    try {
      const result = await saveClientMutation.mutateAsync({
        id: editingClientId !== null ? String(editingClientId) : null,
        data: {
          name,
          pin,
          password,
          obligations: newClientObligations.map(normalizeClientObligation).join(', '),
        },
      });

      if (newClientObligations.includes('paye') && newClientMasterCsv) {
        await uploadMasterCsv(String(result.id), newClientMasterCsv, { propagateError: true });
        setDashboardNotice({
          tone: 'success',
          message:
            editingClientId !== null
              ? 'Client updated and master CSV uploaded successfully.'
              : 'Client saved and master CSV uploaded successfully.',
        });
      } else {
        setDashboardNotice({
          tone: 'success',
          message: editingClientId !== null ? 'Client updated successfully.' : 'Client saved successfully.',
        });
      }
      resetNewClientForm();
    } catch (error) {
      console.error('Save client error:', error);
      const message =
        error instanceof TypeError
          ? 'Could not reach the backend API. Start or restart the backend server on port 3001 and try again.'
          : error instanceof Error
            ? error.message
            : 'Failed to save client.';
      setNewClientModalError(message);
      setDashboardNotice({ tone: 'error', message });
    }
  };

  return {
    editingClientId,
    newClientName,
    setNewClientName,
    newClientPin,
    setNewClientPin,
    newClientPassword,
    setNewClientPassword,
    newClientObligations,
    setNewClientObligations,
    newClientMasterCsv,
    setNewClientMasterCsv,
    newClientModalError,
    setNewClientModalError,
    isSavingClient,
    showNewClientModal,
    resetNewClientForm,
    openNewClientModal,
    handleSaveClient,
  };
}
