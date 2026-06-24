# Lens DSL — 数据集成语言

> **Schema 是一等公民，映射是声明式关系而非操作式步骤。**  
> 停止编写「怎么做」的转换脚本，开始声明「是什么」的关系。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)
![Status](https://img.shields.io/badge/Status-Alpha-orange)

---

## 概述

**Lens** 是一门为**数据集成 (Data Integration)** 而生的**领域特定语言 (DSL)**。

传统 ETL 让你写「怎么做」——先提取、再转换、再加载，每一步都是过程式代码。  
Lens 让你声明「关系是什么」——两个 Schema 之间如何对应，编译器自动推导出转换逻辑。

```lens
// 声明两个 Schema
schema Person {
    first_name: String
    last_name: String
}

schema User {
    full_name: String
}

// 声明它们之间的关系——剩下的交给编译器
mapping PersonToUser : Person -> User {
    full_name = source.first_name + " " + source.last_name
}
```

### 核心理念

| 原则 | 含义 |
|------|------|
| **Schema is Code** | Schema 定义本身就是可执行的类型 |
| **Map by Difference** | 只声明差异，编译器推导出转换逻辑 |
| **Compile-time Safety** | 类型错误、缺失字段、match 不穷尽——编译期报错 |
| **Lineage is Free** | 数据血缘从映射代码自动推导 |

---

## 快速开始

### 前提

- Node.js ≥ 18
- TypeScript ≥ 5.4

### 安装

```bash
# 克隆仓库
git clone https://github.com/kartist/lens.git
cd lens

# 安装依赖
npm install

# 构建
npm run build -w packages/lens
```

### 使用 CLI

```bash
# 类型检查 .lens 文件
npx lens check examples/customer.lens

# 生成 TypeScript / JSON Schema
npx lens generate examples/customer.lens -o dist/ -f typescript
npx lens generate examples/customer.lens -o dist/ -f json-schema

# 查看文件声明
npx lens run examples/customer.lens
```

### 尝试示例

```bash
# 客户数据集成（遗留系统 → 新 API）
npx lens check packages/lens/examples/customer.lens
npx lens generate packages/lens/examples/customer.lens -o output/

# 订单双向同步
npx lens check packages/lens/examples/order.lens
```

---

## 示例速览

### 客户数据集成

将遗留数据库中的客户数据映射到新 API 的 Schema：

```lens
// 语义类型
type Email = /^[^@]+@[^@]+\.[^@]+$/
type CustomerStatus = active | inactive | suspended

// 源 Schema（遗留系统）
schema LegacyCustomer {
    legacy_id: String @id
    full_name: String @required
    contact_email: String
    account_status: String
    phone_1: String?
}

// 目标 Schema（新 API）
schema Customer {
    id: Uuid @id @auto
    name: String @required
    email: Email?
    phone: Phone[]
    status: CustomerStatus
}

// 声明式映射
mapping LegacyToCustomer : LegacyCustomer -> Customer {
    id      = source.legacy_id |> parse_uuid
    name    = source.full_name |> trim |> title_case
    email   = source.contact_email |> normalize_email
    phone   = [source.phone_1?] |> filter_none
    status  = match source.account_status {
        "A" | "B" => active
        "S"      => suspended
        _         => inactive
    }
}
```

生成的 TypeScript 代码：

```typescript
export function LegacyToCustomer(source: LegacyCustomer): Customer {
  return {
    name: __titleCase(__trim(source.full_name)),
    status: (() => {
      switch (source.account_status) {
        case "A": case "B": return "active";
        case "S": return "suspended";
        default: return "inactive";
      }
    })(),
    // ...
  };
}
```

### 订单双向同步

一次声明，正向和反向映射都可执行：

```lens
bidirectional SyncOrder : Order <-> ExternalOrder {
    forward {
        order_id           = source.id |> to_string
        amount             = source.total |> to_string
        state              = match source.status {
            pending   => "NEW"
            shipped   => "SHIPPED"
            delivered => "DONE"
            cancelled => "CANCELLED"
        }
    }

    backward {
        id      = source.order_id |> parse_uuid
        total   = source.amount |> parse_int
        status  = match source.state {
            "NEW"  => pending
            "DONE" => delivered
            _      => pending
        }
    }
}
```

---

## 功能特性

### 类型系统

| 类型 | 说明 |
|------|------|
| `String` / `Int` / `Float` / `Bool` | 基本类型 |
| `DateTime` / `Uuid` / `Decimal` / `Json` | 领域类型 |
| `T?` | 可选类型（可为 null） |
| `T[]` | 数组类型 |
| `type Email = /regex/` | 精炼类型（带正则约束） |
| `type Status = active \| inactive` | 联合类型（编译器穷尽性检查） |

### 映射表达式

| 表达式 | 说明 | 示例 |
|--------|------|------|
| 字段访问 | 读取源字段 | `source.full_name` |
| 管道 | 链式转换 | `source.name \|> trim \|> title_case` |
| Match | 枚举值映射 | `match source.code { "A" => active, _ => inactive }` |
| 子映射 | 嵌套 Schema 委托 | `address = map source via AddressMapping` |
| 双向映射 | 正向 + 反向 | `bidirectional X : A <-> B { forward { } backward { } }` |

### 注解

| 注解 | 含义 |
|------|------|
| `@id` | 主键标识 |
| `@required` | 必填字段 |
| `@auto` / `@audit` | 系统自动管理（无需映射） |
| `@immutable` | 创建后不可修改 |
| `@min(N)` / `@max(N)` | 数值 / 长度约束 |

### 代码生成

支持多种输出格式：

```bash
# TypeScript 接口 + 映射函数
lens generate input.lens -f typescript

# JSON Schema (Draft-7)
lens generate input.lens -f json-schema

# 同时生成两者
lens generate input.lens -f both
```

---

## 项目结构

```
lens/
├── packages/
│   └── lens/                  # 核心语言包
│       ├── src/
│       │   ├── parser/        # 词法分析器 + 解析器 (AST)
│       │   ├── checker/       # 类型检查器 + 语义分析
│       │   ├── codegen/       # 代码生成器 (TS / JSON Schema)
│       │   ├── runtime/       # 运行时内置函数
│       │   ├── index.ts       # 公共 API
│       │   └── cli.ts         # CLI 入口
│       ├── examples/          # 示例 .lens 文件
│       └── LENS_REFERENCE.md  # 完整语言参考
├── package.json               # npm workspaces 根配置
└── README.md                  # 本文档
```

---

## 语言参考

完整的语法、类型系统、内置函数、EBNF 文法请参见：

👉 **[LENS_REFERENCE.md](packages/lens/LENS_REFERENCE.md)**

---

## 路线图

- [x] 词法分析 / 解析 (Lexer + Parser)
- [x] 类型检查器 (Type Checker)
- [x] TypeScript 代码生成
- [x] JSON Schema 生成
- [x] CLI 工具
- [ ] 运行时执行引擎 (Runtime Interpreter)
- [ ] 数据血缘追踪 (Data Lineage)
- [ ] LSP 语言服务器 (IDE 支持)
- [ ] 更多后端格式 (Avro, Protobuf, SQL)

---

## 开发

```bash
# 编译（监听模式）
npm run dev -w packages/lens

# 运行测试
npm test -w packages/lens
```

### 构建流程

```bash
# 一次编译
npm run build -w packages/lens

# 检查示例
node packages/lens/dist/cli.js check packages/lens/examples/customer.lens

# 生成代码
node packages/lens/dist/cli.js generate packages/lens/examples/customer.lens -o output/
```

---

## 许可证

[MIT](LICENSE) © 2026 kartist
