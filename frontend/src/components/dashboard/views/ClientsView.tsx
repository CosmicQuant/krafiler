import { ClientObligation } from '../../../types';
import { ClientTable } from '../ClientTable';

interface ClientsViewProps {
  clients: ClientObligation[];
  onSelectClient: (client: ClientObligation) => void;
  onEditClient: (client: ClientObligation) => void;
}

export function ClientsView({ clients, onSelectClient, onEditClient }: ClientsViewProps) {
  return (
    <ClientTable
      clients={clients}
      onSelectClient={onSelectClient}
      onEditClient={onEditClient}
    />
  );
}
