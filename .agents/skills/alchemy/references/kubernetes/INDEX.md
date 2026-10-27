# kubernetes index

19 pages. Run containers and Effect programs on any Kubernetes cluster with Alchemy. Declare Deployments, Jobs, raw manifests, and Helm charts in the same typed program as the rest of your infrastructure. No YAML, no kubectl apply.

| Page | File | Covers |
| --- | --- | --- |
| Kubernetes | `_overview.md` | Run containers and Effect programs on any Kubernetes cluster with Alchemy. Declare Deployments, Jobs, raw manifests, and Helm charts in the same typed program as the rest of your infrastructure. No YAML, no kubectl apply. |
| Setup | `setup.md` | Install Alchemy and connect it to a Kubernetes cluster, whether a local cluster on your machine, any cluster in your kubeconfig, or an explicit connection for CI. Then add a registry for images built from your code. |

## clusters/

| Page | File | Covers |
| --- | --- | --- |
| Cluster adapters | `clusters/cluster-adapters.md` | The extension point between Alchemy's cluster-agnostic Kubernetes resources and the platform a cluster runs on. Covers authentication, image registries, workload identity, load balancer defaults, and how to write your own. |
| Connecting to clusters | `clusters/connecting.md` | Point Kubernetes resources at any cluster with Kubernetes.KubeConfig, a raw Kubernetes.Connection (bearer token, client certificate, or exec plugin), or a cluster resource such as Kubernetes.LocalCluster. |
| Amazon EKS | `clusters/eks.md` | Run Alchemy's Kubernetes resources on Amazon EKS. Find the guide for creating clusters, ECR images, Pod Identity, and load balancers. |
| Local clusters | `clusters/local.md` | Run a Kubernetes cluster on your machine with Kubernetes.LocalCluster. It is a kind cluster in Docker with an image registry wired into its nodes, so Effect programs and Dockerfiles deploy the same way they do on a hosted cluster. |
| Container registries | `clusters/registries.md` | Give a Kubernetes connection a registry so Deployments and Jobs built from Effect programs or Dockerfiles are pushed where the cluster's nodes can pull them, such as GHCR, Docker Hub, Artifact Registry, ACR, or a registry of your own. |

## objects/

| Page | File | Covers |
| --- | --- | --- |
| Helm charts | `objects/helm-charts.md` | Install Helm charts with Kubernetes.HelmChart. Covers repository, OCI, and local charts, values, release names, namespaces, CRDs, hooks, and how Alchemy owns the rendered objects instead of a Helm release. |
| Manifests | `objects/manifests.md` | Apply any single Kubernetes object with Kubernetes.Manifest, including Namespaces, ConfigMaps, Secrets, StatefulSets, Ingresses, CRDs and custom resources, and order objects with Output references. |

## tutorial/

| Page | File | Covers |
| --- | --- | --- |
| Part 1: Your First Deployment | `tutorial/part-1.md` | Create a Stack, start a Kubernetes cluster on your machine with Kubernetes.LocalCluster, deploy a replicated HTTP service with Kubernetes.Deployment, and reach it with kubectl. |
| Part 2: Namespaces & Configuration | `tutorial/part-2.md` | Create a Namespace with Kubernetes.Manifest, move the Deployment into it, and configure the app with environment variables and resource limits. |
| Part 3: Effect Jobs | `tutorial/part-3.md` | Write a smoke test as an Effect program, run it as a Kubernetes Job that Alchemy builds and pushes for you, watch it re-run when the program changes, and schedule it as a CronJob. |
| Part 4: Install a Helm Chart | `tutorial/part-4.md` | Install metrics-server from its Helm chart with Kubernetes.HelmChart, pass chart values, and check pod metrics with kubectl top. |
| Part 5: Deploy to Your Own Cluster | `tutorial/part-5.md` | Point the tutorial stack at a hosted Kubernetes cluster such as GKE, AKS, EKS, k3s, or anything in your kubeconfig. Keep the local cluster for development with stages, and clean up. |

## workloads/

| Page | File | Covers |
| --- | --- | --- |
| Configuration & bindings | `workloads/bindings.md` | Pass configuration into Kubernetes workloads with env and Outputs, understand the variables Alchemy sets, keep secrets out of plain text, and use bindings. |
| Deployments | `workloads/deployments.md` | Run a replicated server on any Kubernetes cluster with Kubernetes.Deployment. Covers names, namespaces, Service types and URLs, replicas, resources, labels, the pod template escape hatch, and Effect servers. |
| Container images | `workloads/images.md` | Choose where a Deployment or Job's container image comes from and where built images are pushed. Sources are a registry reference, your own Dockerfile, or a bundled Effect program. |
| Jobs & CronJobs | `workloads/jobs.md` | Run work to completion with Kubernetes.Job, as a container image or as an Effect program, and on a schedule as a CronJob. Covers how Job names, re-runs, retries, and cleanup work. |
| How objects are managed | `workloads/object-lifecycle.md` | How Alchemy applies, orders, prunes, and deletes Kubernetes objects, including server-side apply and field ownership, drift, replacement, unreachable clusters, and adoption. |
