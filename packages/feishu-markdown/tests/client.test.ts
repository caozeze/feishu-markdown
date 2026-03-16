import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FeishuClient } from '@/client';

vi.mock('axios');

describe('FeishuClient', () => {
  const mockPost = vi.fn();
  // Mock axios instance
  const mockAxiosInstance = {
    post: mockPost,
    request: vi.fn(), // request method is used by this.request
    interceptors: {
      response: { use: vi.fn() },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    (axios.create as any).mockReturnValue(mockAxiosInstance);
  });

  it('should call addCollaborator when feishuMobile is set', async () => {
    const client = new FeishuClient({
      appId: 'appId',
      appSecret: 'appSecret',
      feishuMobile: '13800000000',
    });

    // Mock getTenantAccessToken response
    mockPost.mockResolvedValueOnce({
      data: {
        code: 0,
        tenant_access_token: 'token',
        expire: 7200,
      },
    });

    // Mock getUserIdByMobile response
    mockAxiosInstance.request.mockResolvedValueOnce({
      data: {
        code: 0,
        msg: 'success',
        data: {
          user_list: [
            {
              user_id: 'ou_123456',
              mobile: '13800000000',
            },
          ],
        },
      },
    });

    // Mock addCollaborator response
    mockAxiosInstance.request.mockResolvedValueOnce({
      data: {
        code: 0,
        msg: 'success',
      },
    });

    await client.addCollaborator('docToken');

    expect(mockPost).toHaveBeenCalledTimes(1); // Token call
    expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2); // API calls

    // Check getTenantAccessToken call
    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      '/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: 'appId',
        app_secret: 'appSecret',
      }
    );

    // Check getUserIdByMobile call
    expect(mockAxiosInstance.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'POST',
        url: '/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id',
        data: {
          mobiles: ['13800000000'],
        },
      })
    );

    // Check addCollaborator call
    expect(mockAxiosInstance.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'POST',
        url: '/open-apis/drive/v1/permissions/docToken/members?type=docx',
        data: {
          member_type: 'openid',
          member_id: 'ou_123456',
          perm: 'full_access',
        },
      })
    );
  });

  it('should call transferOwner when feishuMobile is set', async () => {
    const client = new FeishuClient({
      appId: 'appId',
      appSecret: 'appSecret',
      feishuMobile: '13800000000',
    });

    // Mock getTenantAccessToken response
    mockPost.mockResolvedValueOnce({
      data: {
        code: 0,
        tenant_access_token: 'token',
        expire: 7200,
      },
    });

    // Mock getUserIdByMobile response
    mockAxiosInstance.request.mockResolvedValueOnce({
      data: {
        code: 0,
        msg: 'success',
        data: {
          user_list: [
            {
              user_id: 'ou_123456',
              mobile: '13800000000',
            },
          ],
        },
      },
    });

    // Mock transferOwner response
    mockAxiosInstance.request.mockResolvedValueOnce({
      data: {
        code: 0,
        msg: 'success',
      },
    });

    await client.transferOwner('docToken');

    expect(mockPost).toHaveBeenCalledTimes(1); // Token call
    expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2); // API calls

    // Check getTenantAccessToken call
    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      '/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: 'appId',
        app_secret: 'appSecret',
      }
    );

    // Check transferOwner call
    expect(mockAxiosInstance.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'POST',
        url: '/open-apis/drive/v1/permissions/docToken/members/transfer_owner?type=docx',
        data: {
          member_type: 'openid',
          member_id: 'ou_123456',
        },
      })
    );
  });

  it('should not call addCollaborator when feishuMobile is not set', async () => {
    const client = new FeishuClient({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    await client.addCollaborator('docToken');

    expect(mockPost).not.toHaveBeenCalled();
    expect(mockAxiosInstance.request).not.toHaveBeenCalled();
  });

  it('should fetch document info', async () => {
    const client = new FeishuClient({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    mockPost.mockResolvedValueOnce({
      data: {
        code: 0,
        tenant_access_token: 'token',
        expire: 7200,
      },
    });

    mockAxiosInstance.request.mockResolvedValueOnce({
      data: {
        code: 0,
        msg: 'success',
        data: {
          document: {
            document_id: 'doc123',
            revision_id: 7,
            title: 'Doc Title',
          },
        },
      },
    });

    const result = await client.getDocument('doc123');

    expect(result).toEqual({
      document: {
        document_id: 'doc123',
        revision_id: 7,
        title: 'Doc Title',
      },
    });
    expect(mockAxiosInstance.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/open-apis/docx/v1/documents/doc123',
      })
    );
  });

  it('should batch delete child blocks by index range', async () => {
    const client = new FeishuClient({
      appId: 'appId',
      appSecret: 'appSecret',
    });

    mockPost.mockResolvedValueOnce({
      data: {
        code: 0,
        tenant_access_token: 'token',
        expire: 7200,
      },
    });

    mockAxiosInstance.request.mockResolvedValueOnce({
      data: {
        code: 0,
        msg: 'success',
        data: null,
      },
    });

    await client.deleteChildBlocks('doc123', 'parent456', 0, 10);

    expect(mockAxiosInstance.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        url: '/open-apis/docx/v1/documents/doc123/blocks/parent456/children/batch_delete',
        data: {
          start_index: 0,
          end_index: 10,
        },
      })
    );
  });
});
