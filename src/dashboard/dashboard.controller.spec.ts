import { DashboardController } from './dashboard.controller';

describe('DashboardController permission scoping', () => {
  it('only requests revenue for administrators with billing access', () => {
    const dashboard = { overview: jest.fn() };
    const controller = new DashboardController(dashboard as never);

    void controller.overview({
      permissions: ['platform.dashboard.read'],
    } as never);
    void controller.overview({
      permissions: ['platform.dashboard.read', 'billing.read'],
    } as never);

    expect(dashboard.overview).toHaveBeenNthCalledWith(1, false);
    expect(dashboard.overview).toHaveBeenNthCalledWith(2, true);
  });
});
