# Lens Language Reference

> **Lens** 是一门为**数据集成 (Data Integration)** 而生的领域特定语言 (DSL)。  
> 核心理念：**Schema 是一等公民，映射是声明式关系而非操作式步骤。**

---

## 目录

1. [设计哲学](#1-设计哲学)
2. [Hello World](#2-hello-world)
3. [类型系统](#3-类型系统)
4. [Schema 定义](#4-schema-定义)
5. [类型别名](#5-类型别名)
6. [映射 (Mapping)](#6-映射-mapping)
7. [映射表达式](#7-映射表达式)
8. [双向映射](#8-双向映射)
9. [注解 (Annotations)](#9-注解-annotations)
10. [内置函数](#10-内置函数)
11. [编译 & 生成](#11-编译--生成)
12. [完整示例](#12-完整示例)
13. [附录：语法速查表](#13-附录语法速查表)

---

## 1. 设计哲学

数据集的本质是**消解差异**——两个系统之间的数据在结构、类型、语义、时空中存在差异。  
传统 ETL 让你写「怎么做」(步骤式)，Lens 让你声明「关系是什么」(声明式)。

```
传统方式:  source -> extract -> transform -> validate -> load
Lens 方式:  Schema A 与 Schema B 的映射关系 → 编译器推导出转换
```

### 核心原则

| 原则 | 含义 |
|------|------|
| **Schema is Code** | Schema 定义本身就是可执行的类型 |
| **Map by Difference** | 只声明差异，编译器推导出转换逻辑 |
| **Compile-time Safety** | 类型错误、缺失字段、match 不穷尽——编译期报错 |
| **Lineage is Free** | 数据血缘从映射代码自动推导 |

---

## 2. Hello World

最简单的 Lens 程序——两个 schema 之间的字段映射：

```lens
schema Person {
    first_name: String
    last_name: String
}

schema User {
    full_name: String
}

mapping PersonToUser : Person -> User {
    full_name = source.first_name + " " + source.last_name
}
```

运行检查：
```bash
lens check hello.lens
```

生成 TypeScript：
```bash
lens generate hello.lens -o dist/ -f typescript
```

---

## 3. 类型系统

### 3.1 基本类型 (Primitives)

| 类型 | 含义 | TypeScript 映射 | JSON Schema 映射 |
|------|------|----------------|------------------|
| `String` | 字符串 | `string` | `{ type: "string" }` |
| `Int` | 整数 | `number` | `{ type: "integer" }` |
| `Float` | 浮点数 | `number` | `{ type: "number" }` |
| `Bool` | 布尔值 | `boolean` | `{ type: "boolean" }` |
| `DateTime` | 日期时间 | `Date` | `{ type: "string", format: "date-time" }` |
| `Uuid` | UUID | `string` | `{ type: "string", format: "uuid" }` |
| `Decimal` | 高精度数字 | `number` | `{ type: "number" }` |
| `Json` | JSON 数据 | `Record<string, unknown>` | `{ type: "object" }` |

### 3.2 复合类型

| 类型 | 语法 | 含义 | 示例 |
|------|------|------|------|
| **Optional** | `T?` | 可为 null | `String?` |
| **Array** | `T[]` | 数组 | `Phone[]` |
| **Schema Ref** | `SchemaName` | 引用另一个 schema | `Address` |
| **Nominal** | `TypeName` | 命名类型 (由 type alias 定义) | `Email` |

### 3.3 类型组合规则

```lens
field: String         // 必填字符串
field: String?        // 可选字符串
field: String[]       // 字符串数组
field: String?[]      // 元素为可选字符串的数组
field: String[]?      // 可选的字符串数组
field: Address        // 嵌套 schema
field: Email?[]       // 可选邮件类型的数组
```

### 3.4 类型兼容性 (Type Compatibility)

编译器在检查映射时，遵循以下兼容规则：

| 规则 | 说明 |
|------|------|
| **同一类型** | 完全匹配 |
| **Optional 宽松** | `T` 可赋值给 `T?`，`T?` 可赋值给 `T` |
| **精炼类型** | `String` 可赋值给 `Email` (Email 是 String 的精炼) |
| **命名类型** | 不同变体之间互相兼容 (常见于 union 的 match 分支) |
| **String 统一** | 任何基本类型都可转换为 `String` |
| **数值提升** | `Int` / `Float` 可赋值给 `Decimal` |
| **Schema 引用** | 按名称匹配，子映射返回的 schema 与字段类型按名称兼容 |

---

## 4. Schema 定义

Schema 是 Lens 的核心抽象——它定义了一组数据的**形状**和**约束**。

### 4.1 基本 Schema

```lens
schema Customer {
    id: Uuid @id
    name: String @required @max(200)
    email: Email?
    phone: Phone[]
    address: Address
    status: CustomerStatus
    created_at: DateTime @immutable
    updated_at: DateTime @audit
}
```

每个字段由 `字段名: 类型 @注解...` 组成。

### 4.2 嵌套 Schema

```lens
schema Order {
    id: Uuid @id
    customer_name: String
    total: Decimal @min(0)
    status: OrderStatus
    items: OrderItem[] @min_length(1)   // 数组 + 约束
    notes: String?                      // 可选字段
    created_at: DateTime @immutable
}
```

### 4.3 注解 (Annotations)

注解是对字段的元数据约束，使用 `@` 前缀：

```lens
schema User {
    id: Uuid @id                           // 主键标识
    email: String @required                // 必填
    name: String @max(200)                 // 最大长度
    age: Int @min(0) @max(150)             // 数值范围
    tags: String[] @min_length(1)          // 数组最小长度
    created_at: DateTime @immutable        // 只读(创建后不可变)
    updated_at: DateTime @audit            // 自动审计字段
    order_ids: Uuid[] @references(Order.id) // 跨 schema 引用
}
```

---

## 5. 类型别名

类型别名让你给已有的类型赋予**语义含义**，或者定义**枚举/联合类型**。

### 5.1 精炼类型 (Refined Type)

基于 String 的正则约束：

```lens
type Email = /^[^@]+@[^@]+\.[^@]+$/
type Phone = /^\+?[1-9]\d{1,14}$/
type UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
```

编译器生成的 JSON Schema 会自动包含 `pattern` 约束。

### 5.2 包装类型 (Wrapper Type)

为基本类型起有意义的别名：

```lens
type Phone = String
type UserID = Uuid
type Money = Decimal
```

### 5.3 字符串联合 (String Union)

```lens
type CountryCode = "CN" | "US" | "JP" | "UK" | "DE"
type PaymentMethod = "credit_card" | "alipay" | "wechat" | "bank_transfer"
```

### 5.4 标识符联合 (Identifier Union)

```lens
type OrderStatus = pending | confirmed | shipped | delivered | cancelled
type CustomerTier = bronze | silver | gold | platinum
```

联合类型在编译期会进行**穷尽性检查 (exhaustiveness check)**——如果 match 没有覆盖所有变体，编译器报错。

---

## 6. 映射 (Mapping)

映射是 Lens 最核心的构造——它声明性地描述如何从源 Schema 转换到目标 Schema。

### 6.1 基本映射

```lens
mapping LegacyToCustomer : LegacyCustomer -> Customer {
    id       = source.legacy_id |> parse_uuid
    name     = source.full_name |> trim |> title_case
    email    = source.contact_email |> normalize_email
    status   = match source.account_status {
        "A" | "B" => active
        "S"      => suspended
        "X"      => inactive
        _         => inactive
    }
    created_at = now()
}
```

`mapping 名字 : 源Schema -> 目标Schema { 字段映射... }`

### 6.2 映射签名

```lens
// 单向映射
mapping MappingName : SourceSchema -> TargetSchema { ... }

// 映射名 + 签名 + 主体
mapping AddressMapping : LegacyCustomer -> Address {
    line1     = source.addr_line1
    city      = source.city_name |> normalize_city
    country   = source.country_abbr
}
```

### 6.3 字段映射规则

每个字段映射的左侧是**目标 Schema 中的字段名**，右侧是**表达式**：

```lens
target_field = <expression>
```

编译器会检查：
- ✅ 目标字段名是否确实存在于目标 Schema 中
- ✅ 表达式的类型是否与目标字段类型兼容
- ✅ 目标 Schema 的所有必填字段是否都被覆盖
- ✅ 如果源字段访问了不存在的字段，编译报错

### 6.4 子映射 (Sub-mapping)

当字段是嵌套 Schema 时，可以用子映射：

```lens
schema Customer {
    address: Address     // 嵌套 schema
}

mapping LegacyToCustomer : LegacyCustomer -> Customer {
    address   = map source via AddressMapping   // 委托给子映射
}

mapping AddressMapping : LegacyCustomer -> Address {
    line1     = source.addr_line1
    city      = source.city_name |> normalize_city
    postcode  = source.zip_code
}
```

### 6.5 必填字段检查

编译器会检查目标 Schema 中**所有非可选字段**是否都有对应的映射：

```lens
schema Target {
    id: Uuid @id @auto     // @auto 字段不受检查
    name: String           // ✓ 必须映射
    email: String?         // ✗ 可选，可以不映射（但会有 warning）
}
```

---

## 7. 映射表达式

映射表达式的右侧可以是一个表达式，下表列出了所有支持的表达式类型。

### 7.1 字段访问 (Field Access)

```lens
target = source.field_name         // 直接读取
target = source.field.sub_field    // 嵌套字段
target = source.contact.email_addr // 多级嵌套
```

### 7.2 字面量 (Literal)

```lens
target = "hello"      // 字符串
target = 42           // 整数
target = 3.14         // 浮点
target = true         // 布尔
target = null         // 空值
```

### 7.3 管道表达式 (Pipe)

这是 Lens 中最常用的数据转换方式——将前一个表达式的结果作为函数调用的第一个参数：

```lens
// 等价于 trim(source.full_name)
name = source.full_name |> trim

// 链式管道：等价于 titleCase(trim(source.full_name))
name = source.full_name |> trim |> title_case

// 带额外参数的函数调用
value = source.int_str |> parse_int
text  = source.int_val |> to_string
```

管道运算符 `|>` 将左侧的结果传递给右侧的函数。右侧可以是一个函数名（不带括号），也可以是一个函数调用（带括号和额外参数）。

### 7.4 函数调用 (Function Call)

```lens
// 不带参数
created_at = now()

// 带参数（在管道中，第一个参数来自管道左侧）
result = function_name(arg1, arg2)
```

### 7.5 Null 安全传播 (Coalesce)

`?` 后缀表示"这个值可能为空"——常用于处理可选字段：

```lens
// 如果 phone_1 是 String?，? 表示空值可接受
phone = source.phone_1?

// 在数组中
phones = [source.phone_1?, source.phone_2?]         // 包含 null 的数组
phones = [source.phone_1?, source.phone_2?] |> filter_none  // 过滤掉 null
```

### 7.6 二值运算 (Binary)

```lens
// 字符串连接
full_name = source.first_name + " " + source.last_name

// 数学运算（将来扩展）
total = source.quantity + source.bonus
```

### 7.7 Match 表达式

Match 用于枚举/联合类型的值映射——这是数据集成中最常见的模式：

```lens
// 简单匹配
status = match source.status_code {
    "A" => active
    "I" => inactive
    _   => unknown
}

// 多模式匹配（一个值匹配多个模式）
status = match source.status_code {
    "A" | "B" => active
    "S"      => suspended
    "X"      => inactive
    _         => inactive
}

// 数字匹配
priority = match source.priority {
    1 => high
    2 => medium
    3 => low
    _ => unknown
}

// 变体名匹配（identifer union）
tier = match source.customer_type {
    bronze => "B"
    silver => "S"
    gold   => "G"
    _      => "U"
}
```

**Match 的穷尽性检查**：如果 subject 是 union 类型，编译器会检查所有变体是否都被覆盖。如果没有覆盖全且没有 `_` 兜底，编译报错。

### 7.8 数组字面量 (Array Literal)

```lens
// 直接构造数组
phone = [source.phone_1, source.phone_2]

// 过滤空值
phone = [source.phone_1?, source.phone_2?] |> filter_none
```

### 7.9 表达式优先级

| 优先级 | 表达式 | 结合性 |
|--------|--------|--------|
| **最低** | `|>` (pipe) | 左结合 |
| **中** | `+` `-` (binary) | 左结合 |
| **中** | `?` (coalesce) | — |
| **最高** | 函数调用、字段访问、字面量、match、`(...)` | — |

---

## 8. 双向映射

Lens 的一个关键创新是**原生支持双向映射**——一次声明，正向和反向都可执行。

### 8.1 基本语法

```lens
bidirectional SyncOrder : Order <-> ExternalOrder {
    forward {
        order_id           = source.id |> to_string
        customer_full_name = source.customer_name
        amount             = source.total |> to_string
        state              = match source.status {
            pending    => "NEW"
            confirmed  => "CONFIRMED"
            shipped    => "SHIPPED"
            delivered  => "DONE"
            cancelled  => "CANCELLED"
            _          => "UNKNOWN"
        }
        placed_at = source.created_at |> to_string
    }

    backward {
        id             = source.order_id |> parse_uuid
        customer_name  = source.customer_full_name
        total          = source.amount |> parse_int
        status         = match source.state {
            "NEW"       => pending
            "CONFIRMED" => confirmed
            "SHIPPED"   => shipped
            "DONE"      => delivered
            "CANCELLED" => cancelled
            _           => pending
        }
        created_at = now()
    }
}
```

`bidirectional 名字 : 源Schema <-> 目标Schema { forward { ... } backward { ... } }`

### 8.2 生成的代码

上述双向映射会生成两组 TypeScript 函数：

```typescript
// 正向：Order -> ExternalOrder
export function SyncOrder_forward(source: Order): ExternalOrder { ... }

// 反向：ExternalOrder -> Order
export function SyncOrder_backward(source: ExternalOrder): Order { ... }
```

### 8.3 使用场景

| 场景 | 说明 |
|------|------|
| **API 请求/响应** | 正向 = 序列化 (domain → API)，反向 = 反序列化 (API → domain) |
| **数据同步** | 双向同步两个系统中的同一实体 |
| **CDC (Change Data Capture)** | 正向记录变更事件，反向回放 |

---

## 9. 注解 (Annotations)

### 9.1 所有支持的注解

| 注解 | 含义 | 示例 |
|------|------|------|
| `@id` | 标记为主键字段 | `id: Uuid @id` |
| `@required` | 标记为必填 | `name: String @required` |
| `@auto` | 由系统自动生成（无需映射） | `id: Uuid @id @auto` |
| `@immutable` | 创建后不可修改 | `created_at: DateTime @immutable` |
| `@audit` | 审计字段（系统管理） | `updated_at: DateTime @audit` |
| `@max(N)` | 最大长度/数值 | `name: String @max(200)` |
| `@min(N)` | 最小长度/数值 | `age: Int @min(0)` |
| `@min_length(N)` | 数组最小长度 | `tags: String[] @min_length(1)` |
| `@max_length(N)` | 数组最大长度 | `items: Item[] @max_length(100)` |
| `@references(Schema.field)` | 跨 schema 引用 | `user_id: Uuid @references(User.id)` |

### 9.2 注解对编译器的影响

- `@auto` / `@audit` → 目标字段即使不是 optional，也**可以不在映射中覆盖**
- `@required` → 检查源字段映射时，该字段在目标中是**必须**的
- `@immutable` → 如果映射试图写这个字段，会触发 **warning**
- `@min` / `@max` / `@min_length` → 在生成的 JSON Schema 中转换为对应的约束

---

## 10. 内置函数

所有内置函数在生成 TypeScript 代码时会在运行时文件中被引用。

### 10.1 字符串处理

| 函数 | 签名 | 说明 |
|------|------|------|
| `trim` | `String -> String` | 去除两端空白 |
| `title_case` | `String -> String` | 转换为 Title Case |
| `lowercase` | `String -> String` | 转换为小写 |
| `uppercase` | `String -> String` | 转换为大写 |
| `split_first` | `String -> String` | 按第一个空格分割，取前半 |
| `split_last` | `String -> String` | 按最后一个空格分割，取后半 |

### 10.2 数据转换

| 函数 | 签名 | 说明 |
|------|------|------|
| `parse_uuid` | `String -> Uuid` | 解析 UUID（含格式校验） |
| `parse_int` | `String -> Int` | 解析整数 |
| `to_string` | `(any) -> String` | 转换为字符串 |
| `now` | `() -> DateTime` | 获取当前时间 |

### 10.3 数据清洗

| 函数 | 签名 | 说明 |
|------|------|------|
| `normalize_email` | `String -> String` | 规范化邮箱（trim + lowercase） |
| `normalize_city` | `String -> String` | 规范化城市名（trim + title case） |
| `filter_none` | `(T?[]) -> T[]` | 过滤数组中的 null/undefined |

### 10.4 使用示例

```lens
// 直接调用
now()

// 管道调用
name = source.name |> trim |> title_case
email = source.email |> normalize_email
city = source.city |> normalize_city
id = source.id_str |> parse_uuid
amount = source.amount_str |> parse_int
text = source.number |> to_string
phones = [source.p1?, source.p2?] |> filter_none
```

---

## 11. 编译 & 生成

### 11.1 CLI 命令

```bash
# 类型检查
lens check <files...>

# 代码生成
lens generate <files...> [-o <output_dir>] [-f <format>]

# 查看声明
lens run <files...>
```

### 11.2 生成格式

| 格式 | 说明 |
|------|------|
| `typescript` (默认) | TypeScript 接口 + 映射函数 |
| `json-schema` | JSON Schema Draft-7 |
| `both` | 同时生成两者 |

### 11.3 生成产物

```
output/
├── customer.ts              # TypeScript 接口 + 映射函数
├── order.ts                 # 双向映射函数
├── Customer.schema.json     # JSON Schema Draft-7
├── LegacyCustomer.schema.json
├── Address.schema.json
└── lens-runtime.ts          # 运行时内置函数
```

### 11.4 生成的 TypeScript 示例

对于以下 Lens 映射：

```lens
mapping LegacyToCustomer : LegacyCustomer -> Customer {
    name = source.full_name |> trim |> title_case
    status = match source.code {
        "A" | "B" => active
        _         => inactive
    }
}
```

生成：

```typescript
export function LegacyToCustomer(source: LegacyCustomer): Customer {
  return {
    name: __titleCase(__trim(source.full_name)),
    status: (() => {
      switch (source.code) {
        case "A":
        case "B":
          return "active";
        default:
          return "inactive";
      }
    })(),
  };
}
```

---

## 12. 完整示例

### 示例 1：客户数据集成

```lens
// ============================================================
// 场景：将遗留系统的客户数据同步到新 API
// ============================================================

// 语义类型
type Email = /^[^@]+@[^@]+\.[^@]+$/
type Phone = String
type CustomerStatus = active | inactive | suspended

// 源 Schema（遗留数据库）
schema LegacyCustomer {
    legacy_id: String @id
    full_name: String @required @max(200)
    contact_email: String
    addr_line1: String
    city_name: String
    account_status: String
    phone_1: String?
    created_at: DateTime
}

// 目标 Schema（新 API）
schema Customer {
    id: Uuid @id @auto
    name: String @required @max(200)
    email: Email?
    phone: Phone[]
    address: Address
    status: CustomerStatus
    updated_at: DateTime @audit
}

schema Address {
    line1: String
    city: String
    postcode: String?
}

// 映射
mapping LegacyToCustomer : LegacyCustomer -> Customer {
    id      = source.legacy_id |> parse_uuid
    name    = source.full_name |> trim |> title_case
    email   = source.contact_email |> normalize_email
    phone   = [source.phone_1?] |> filter_none
    address = map source via AddressMapping
    status  = match source.account_status {
        "A" | "B" => active
        "S"      => suspended
        "X"      => inactive
        _         => inactive
    }
    updated_at = now()
}

mapping AddressMapping : LegacyCustomer -> Address {
    line1    = source.addr_line1
    city     = source.city_name |> normalize_city
    postcode = null
}
```

### 示例 2：订单双向同步

```lens
// ============================================================
// 场景：内部订单系统与外部 API 的双向同步
// ============================================================

type OrderStatus = pending | confirmed | shipped | delivered | cancelled

schema Order {
    id: Uuid @id
    customer_name: String
    total: Decimal @min(0)
    status: OrderStatus
    created_at: DateTime @immutable
}

schema ExternalOrder {
    order_id: String
    customer_full_name: String
    amount: String
    state: String
    placed_at: String
}

bidirectional SyncOrder : Order <-> ExternalOrder {
    forward {
        order_id           = source.id |> to_string
        customer_full_name = source.customer_name
        amount             = source.total |> to_string
        state              = match source.status {
            pending    => "NEW"
            confirmed  => "CONFIRMED"
            shipped    => "SHIPPED"
            delivered  => "DONE"
            cancelled  => "CANCELLED"
            _          => "UNKNOWN"
        }
        placed_at = source.created_at |> to_string
    }

    backward {
        id             = source.order_id |> parse_uuid
        customer_name  = source.customer_full_name
        total          = source.amount |> parse_int
        status         = match source.state {
            "NEW"       => pending
            "CONFIRMED" => confirmed
            "SHIPPED"   => shipped
            "DONE"      => delivered
            "CANCELLED" => cancelled
            _           => pending
        }
        created_at = now()
    }
}
```

---

## 13. 附录：语法速查表

### 13.1 词法 (Lexical)

| 记法 | 含义 |
|------|------|
| `// 注释` | 单行注释 |
| `"string"` / `'string'` | 字符串字面量 |
| `/pattern/` | 正则字面量 |
| `123` / `3.14` | 数字字面量 |
| `true` / `false` / `null` | 布尔/空值字面量 |
| `->` | 映射箭头 |
| `<->` | 双向映射箭头 |
| `=>` | Match 箭头 |
| `|>` | 管道运算符 |
| `|` | 联合类型分隔符 |
| `source.field` | 源字段访问 |
| `@name(args)` | 注解 |

### 13.2 关键字

```
schema    type      mapping   bidirectional
forward   backward  match     map
source    via       as
String    Int       Float     Bool
DateTime  Uuid      Decimal   Json
```

### 13.3 EBNF 语法概览

```ebnf
Document        = { Declaration }
Declaration     = SchemaDecl | TypeAliasDecl | MappingDecl | BidirectionalDecl

(* Schema *)
SchemaDecl      = "schema" Ident "{" { SchemaField } "}"
SchemaField     = Ident ":" Type { Annotation }
Type            = ( Primitive | Ident ) [ "?" ] [ "[]" ]

(* Type Alias *)
TypeAliasDecl   = "type" Ident "=" (
                    Regex
                  | Ident
                  | StringLit { "|" StringLit }
                  | Ident { "|" Ident }
                  )

(* Mapping *)
MappingDecl     = "mapping" Ident ":" Ident "->" Ident "{" { MappingField } "}"
MappingField    = Ident "=" Expression

(* Bidirectional *)
Bidirectional   = "bidirectional" Ident ":" Ident "<->" Ident "{"
                    "forward"  "{" { MappingField } "}"
                    "backward" "{" { MappingField } "}"
                  "}"

(* Expressions *)
Expression      = PipeExpr
PipeExpr        = BinaryExpr { "|>" Ident [ "(" [ Expr { "," Expr } ] ")" ] }
BinaryExpr      = CoalesceExpr { ( "+" | "-" ) CoalesceExpr }
CoalesceExpr    = AtomicExpr { "?" }

AtomicExpr      = FieldAccess
                | Literal
                | FunctionCall
                | MatchExpr
                | ArrayLiteral
                | SubMapping
                | "(" Expression ")"

FieldAccess     = "source" "." Ident { "." Ident }
                | Ident            (* variant literal *)

FunctionCall    = Ident "(" [ Expr { "," Expr } ] ")"

MatchExpr       = "match" Expression "{"
                    { ( StringLit | NumberLit | Ident | "_" ) "=>" Expression }
                  "}"

SubMapping      = "map" "source" "via" Ident
ArrayLiteral    = "[" [ Expr { "," Expr } ] "]"

(* Annotations *)
Annotation      = "@" Ident [ "(" AnnotArg { "," AnnotArg } ")" ]
AnnotArg        = StringLit | NumberLit | BoolLit | Ident | Regex

(* Terminals *)
Ident           = letter { letter | digit | "_" }
StringLit       = '"' { any_char } '"' | "'" { any_char } "'"
NumberLit       = digit { digit } [ "." digit { digit } ]
BoolLit         = "true" | "false"
Regex           = "/" { regex_char } "/"
```

---

> Lens 的核心思想：**"Stop writing transformations. Start declaring relationships."**  
> 你不再写「怎么做」，而是声明「A 和 B 之间有什么关系」——编译器从关系推导出操作，从结构推导出验证，从映射推导出血缘。
