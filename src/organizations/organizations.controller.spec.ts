import { OrganizationsController } from './organizations.controller';

describe('OrganizationsController permission scoping', () => {
  const organizations = {
    list: jest.fn(),
    findOne: jest.fn(),
  };
  const controller = new OrganizationsController(
    organizations as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('redacts billing from list requests without billing permission', () => {
    void controller.list({ page: 1, pageSize: 25 }, {
      permissions: ['tenant.read'],
    } as never);

    expect(organizations.list).toHaveBeenCalledWith(
      { page: 1, pageSize: 25 },
      false,
    );
  });

  it('passes independent billing and audit access to organization detail', () => {
    void controller.findOne('tenant-1', { page: 1, pageSize: 25 }, {
      permissions: ['tenant.read', 'security.read'],
    } as never);

    expect(organizations.findOne).toHaveBeenCalledWith(
      'tenant-1',
      { billing: false, audit: true },
      { page: 1, pageSize: 25 },
    );
  });
});
