# 根据OAuth2.0授权协议获取accessToken

云之家对外开放的接口都需要通过**云之家OAuth2.0授权协议**获取到**`accessToken`**进行授权后才能访问，目前云之家接口资源授权级别可分为三大类，分别为`app`，`team`，`resGroupSecret`。

**<h1>  接口调用流程示意图 </h1>**

**开发者轻应用开发注意事项:**

云之家开放平台接口面向的是服务端调用，如果直接通过HTML端JS请求：

1. 会有ajax跨域问题;
1. 如果把相关密钥信息配置于前端JS或配置文件极容易<span style="background-color:rgb(255, 255, 0)">导致信息泄漏造成不可挽回的后果;</span>

云之家标准接口调用流程示意图如下：

![标准接口调用流程](/opendocs/file/image/17472fc413c4792272fec7add34bcdb3)

**<h1>   API与授权级别对照表 </h1>**

不同业务对应的接口资源授权级别，请参考下表：

| 接口名称                 | api接口                                   | 授权级别scope  |
| ------------------------ | ----------------------------------------- | -------------- |
| 获取用户上下文信息       | `/gateway/ticket/user/acquirecontext/...` | app            |
| 轻应用获取组织与人员信息 | `/gateway/opendata-control/data/...`      | app            |
| 待办消息                 | `/gateway/newtodo/open/...`               | app            |
| 报表秀秀                 | `/gateway/linkerp/...`                    | team           |
| 审批                     | `/gateway/workflow/...`                   | team           |
| 通讯录同步               | `/gateway/openimport/open/...`            | resGroupSecret |
| 签到                     | `/gateway/attendance/data/...`            | resGroupSecret |
| 时间助手                 | `/gateway/cloudwork/newwork/...`          | resGroupSecret |
| 生态圈                   | `/gateway/open/linkspace/...`             | resGroupSecret |
| 群组和消息           | `/gateway/xtinterface/...`                    | resGroupSecret |
| 融合中心           | `/gateway/linkcenter/...`                    | resGroupSecret |



##  获取accessToken

**描述：** 获取对应业务接口的授权accessToken

**注意**
1. `accessToken`的有效时间为**6400秒**，在该有效期内多次获取均返回同一token，建议开发者将其缓存使用，有效的accessToken长度为32位字符串;

2. 授权级别不同，获取`accessToken`接口的输入参数也是不同的，请开发者参照API与授权级别对照表填写输入参数;

3. **相同授权级别的接口资源，只需获取一次**`accessToken`即可。例如获取一次app授权级别的`accessToken`，可用此`accessToken`鉴权获取 <a href="docs.html#/server-api/auth/index" target="_blank">解析用户身份</a>、<a href="docs.html#/server-api/org/index" target="_blank">获取组织数据接口</a>、<a href="docs.html#/server-api/im/im-todo" target="_blank">通知中心</a>


**网络传输协议:**  `HTTPS`

**请求地址:**
`https://www.yunzhijia.com/gateway/oauth2/token/getAccessToken`

**请求方法:**
 `POST`

**内容类型:**
`Content-Type: application/json`

**输入参数:**

**1. 授权级别为app时**

* 接口请求参数如下：

| 字段      | 类型   | 是否必填 | 说明                                          |
| --------- | ------ | -------- | --------------------------------------------- |
| appId     | String | 是       | 轻应用id                                      |
| secret    | String | 是       | 轻应用secret,即appsecret                      |
| timestamp | long   | 是       | 当前北京时间，Unix格式13位时间戳，精确到毫秒，3分钟内有效。 |
| scope     | String | 是       | 授权级别：app                                 |

* JSON示例:

    ```json
    {
        "appId": "xxxxxx",
        "secret": "轻应用secret",
        "timestamp": 1522305194157,
        "scope": "app"
    }

    ```
* postman示例:

![getAccessToken app级别postman示例图](/opendocs/file/image/291254a3d9f3c923cb3197eafb7e63c4)

**2. 授权级别为resGroupSecret时**

* 接口请求参数如下：

| 字段      | 类型   | 是否必填 | 说明                                                                                                                           |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| eid       | String | 是       | 团队id                                                                                                                         |
| secret    | String | 是       | 组织人员通讯录读取密钥、组织人员通讯录同步密钥、签到数据密钥、时间助手密钥、<br>生态圈同步密钥，获取方法参见 <a href="docs.html#/server-api/auth/res-secret.md" target="_blank">根据管理员账号信息获取资源授权密钥</a> |
| timestamp | long   | 是       | 当前北京时间，Unix格式13位时间戳，精确到毫秒，3分钟内有效。                                                                                  |
| scope     | String | 是       | 授权级别：resGroupSecret                                                                                                       |

* JSON示例:

```json
    {
        "eid": "xxxxxx",
        "secret": "资源授权秘钥secret",
        "timestamp": 1522305194157,
        "scope": "resGroupSecret"
    }

```
* postman示例：

![getAccessToken resGroupSecret级别postman示例图](/opendocs/file/image/ebf81ad6aeda6d3be070a674be349808)

**3. 授权级别为team时**

* 接口请求参数如下：

| 字段      | 类型   | 是否必填 | 说明                                          |
| --------- | ------ | -------- | --------------------------------------------- |
| appId     | String | 是       | 轻应用id                                      |
| eid       | String | 是       | 团队id                                        |
| secret    | String | 是       | 轻应用secret，即appsecret                     |
| timestamp | long   | 是       | 当前北京时间，Unix格式13位时间戳，精确到毫秒，3分钟内有效。 |
| scope     | String | 是       | 授权级别：team                                |

* JSON示例:

    ```json
    {
        "appId": "xxxxxx",
        "eid": "xxxxxx",
        "secret": "轻应用secret",
        "timestamp": 1522305194157,
        "scope": "team"
    }
    ```
* postman示例：

![getAccessToken team级别postman示例图](/opendocs/file/image/752a9a86190ba2aef348b9eb198a25be)

* 输出结果:

    ```json
    {
    "data": {
        "accessToken":"accessToken",
        "expireIn":有效时间(秒),
        "refreshToken":"token刷新令牌"
    },
    "errorCode": 0,
    "success": true
    }
    ```

## 刷新accessToken

**描述：** 企业开发者通过[获取accessToken接口](#获取accessToken接口)得到token刷新令牌，刷新accessToken；

**网络传输协议：** `HTTPS`

**请求地址：**`https://www.yunzhijia.com/gateway/oauth2/token/refreshToken`

**请求方法：**`POST`

**内容类型：**`application/json`

**输入参数:**

- 授权级别为**app**时，接口请求参数如下：

| 字段         | 类型   | 是否必填 | 说明                                                             |
| ------------ | ------ | -------- | ---------------------------------------------------------------- |
| appId        | String | 是       | 轻应用id                                                         |
| refreshToken | String | 是       | token刷新令牌，合法长度为32位字符串，由[获取accessToken接口](#获取accessToken接口)得到 |
| timestamp    | String | 是       | 当前北京时间，Unix格式13位时间戳，精确到毫秒，3分钟内有效。                    |
| scope        | String | 是       | 授权级别：app                                                    |

- 授权级别为**team**时，接口请求参数如下：

| 字段         | 类型   | 是否必填 | 说明                                                             |
| ------------ | ------ | -------- | ---------------------------------------------------------------- |
| appId        | String | 是       | 轻应用id                                                         |
| eid          | String | 是       | 团队id                                                           |
| refreshToken | String | 是       | token刷新令牌，合法长度为32位字符串，由[获取accessToken接口](#获取accessToken接口)得到 |
| timestamp    | String | 是       | 当前北京时间，Unix格式13位时间戳，精确到毫秒，3分钟内有效。                    |
| scope        | String | 是       | 授权级别：team                                                   |

- 授权级别为**resGroupSecret**时，接口请求参数如下：

| 字段         | 类型   | 是否必填 | 说明                                                             |
| ------------ | ------ | -------- | ---------------------------------------------------------------- |
| eid          | String | 是       | 团队id                                                           |
| refreshToken | String | 是       | token刷新令牌，合法长度为32位字符串，由[获取accessToken接口](#获取accessToken接口)得到 |
| timestamp    | String | 是       | 当前北京时间，Unix格式13位时间戳，精确到毫秒，3分钟内有效。                    |
| scope        | String | 是       | 授权级别：resGroupSecret                                         |

**输出结果:**

```json
{
  "data": {
      "accessToken":"accessToken",
      "expireIn":有效时间(秒),
      "refreshToken":"token刷新令牌"
  },
  "errorCode": 0,
  "success": true
}

```